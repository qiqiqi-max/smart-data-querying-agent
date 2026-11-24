"""A query must have data and a stated calculation before SQL may be generated."""

import asyncio
import copy
import json
from types import SimpleNamespace

import pytest
from langchain_core.runnables import RunnableLambda
from pydantic import ValidationError

from app.agent.nodes import assess_query as node
from app.agent.query_assessment import QueryAssessment, validate_assessment

CATALOG = {
    "tables": [
        {
            "name": "fact_order",
            "role": "fact",
            "description": "订单金额和数量",
            "columns": [
                {
                    "id": "fact_order.order_amount",
                    "name": "order_amount",
                    "type": "decimal",
                    "role": "measure",
                    "description": "订单金额",
                    "alias": ["销售额"],
                    "examples": [],
                },
                {
                    "id": "fact_order.order_quantity",
                    "name": "order_quantity",
                    "type": "int",
                    "role": "measure",
                    "description": "购买数量",
                    "alias": ["销量"],
                    "examples": [],
                },
                {
                    "id": "fact_order.customer_id",
                    "name": "customer_id",
                    "type": "int",
                    "role": "foreign_key",
                    "description": "客户标识",
                    "alias": ["客户ID"],
                    "examples": [],
                },
            ],
        }
    ],
    "metrics": [
        {
            "id": "metric.gmv",
            "name": "GMV",
            "description": "所有订单的成交金额总和",
            "relevant_columns": ["fact_order.order_amount"],
            "alias": ["成交总额"],
        },
        {
            "id": "metric.aov",
            "name": "AOV",
            "description": "所有订单的成交金额平均值",
            "relevant_columns": ["fact_order.order_quantity"],
            "alias": ["平均订单金额"],
        },
    ],
}


def ready(**changes):
    data = {
        "status": "ready",
        "reason": "clear",
        "message": "",
        "questions": [],
        "missing_information": [],
        "resolved_query": "统计全部订单的成交总额",
        "required_tables": ["fact_order"],
        "required_columns": ["fact_order.order_amount"],
        "metrics": [
            {
                "name": "GMV",
                "source": "configured",
                "metric_id": "metric.gmv",
                "definition": "所有订单的成交金额总和",
                "evidence": "",
                "required_columns": ["fact_order.order_amount"],
            }
        ],
    }
    return {**data, **changes}


def test_known_consistent_metric_is_allowed_without_reinterpreting_definition():
    result = validate_assessment(
        QueryAssessment(**ready()), CATALOG, ["统计全部订单的成交总额"]
    )
    assert result.status == "ready"
    assert result.metrics[0].definition == CATALOG["metrics"][0]["description"]


def test_unknown_field_cannot_be_approved_for_sql():
    result = validate_assessment(
        QueryAssessment(**ready(required_columns=["reviews.score"])),
        CATALOG,
        ["客户满意度"],
    )
    assert result.status == "unsupported"
    assert result.missing_information
    assert "reviews.score" in result.message


def test_undefined_metric_requires_customer_definition():
    usage = {
        "name": "复购率",
        "source": "configured",
        "metric_id": "metric.repeat_rate",
        "definition": "猜测公式",
        "evidence": "",
        "required_columns": ["fact_order.customer_id"],
    }
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[usage])), CATALOG, ["看看复购率"]
    )
    assert result.status == "clarify"
    assert result.reason == "undefined_metric"
    assert result.questions and "复购率" in result.message


def test_aov_amount_definition_cannot_use_quantity_dependency():
    usage = {
        "name": "AOV",
        "source": "configured",
        "metric_id": "metric.aov",
        "definition": CATALOG["metrics"][1]["description"],
        "evidence": "",
        "required_columns": ["fact_order.order_quantity"],
    }
    result = validate_assessment(
        QueryAssessment(
            **ready(metrics=[usage], required_columns=["fact_order.order_quantity"])
        ),
        CATALOG,
        ["平均订单金额"],
    )
    assert result.status == "clarify"
    assert result.reason == "inconsistent_metric"
    assert "金额" in result.message


def test_model_cannot_replace_configured_definition():
    data = ready()
    data["metrics"][0]["definition"] = "成交金额乘以二"
    result = validate_assessment(QueryAssessment(**data), CATALOG, ["成交总额"])
    assert result.status == "clarify"


def test_user_explicit_formula_is_allowed_with_exact_user_evidence():
    formula = "每客户成交额=SUM(fact_order.order_amount)/COUNT(DISTINCT fact_order.customer_id)"
    usage = {
        "name": "每客户成交额",
        "source": "user_explicit",
        "metric_id": None,
        "definition": formula,
        "evidence": formula,
        "required_columns": ["fact_order.order_amount", "fact_order.customer_id"],
    }
    result = validate_assessment(
        QueryAssessment(
            **ready(
                metrics=[usage],
                required_columns=["fact_order.order_amount", "fact_order.customer_id"],
            )
        ),
        CATALOG,
        [formula],
    )
    assert result.status == "ready"


def test_system_question_is_not_user_confirmation_of_formula():
    formula = "复购率=复购客户数/客户总数"
    usage = {
        "name": "复购率",
        "source": "user_explicit",
        "metric_id": None,
        "definition": formula,
        "evidence": formula,
        "required_columns": ["fact_order.customer_id"],
    }
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[usage])), CATALOG, ["看看复购率", "按本月统计"]
    )
    assert result.status == "clarify"
    assert result.reason == "undefined_metric"


def test_named_metric_without_definition_cannot_be_disguised_as_basic_aggregation():
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[])), CATALOG, ["统计复购率"]
    )
    assert result.status == "clarify"


@pytest.mark.parametrize("changes", [{"questions": []}, {"message": ""}])
def test_clarification_requires_concrete_customer_message_and_question(changes):
    data = ready(
        status="clarify",
        reason="ambiguous_query",
        message="请补充时间范围",
        questions=["查看哪个时间范围？"],
    )
    with pytest.raises(ValidationError):
        QueryAssessment(**{**data, **changes})


class Meta:
    async def get_query_catalog(self):
        return copy.deepcopy(CATALOG)


class DW:
    async def get_schema_columns(self):
        return {
            "fact_order": {
                column["name"]: column["type"]
                for column in CATALOG["tables"][0]["columns"]
            }
        }


def evaluate(monkeypatch, answer, query="客户满意度", physical=None):
    monkeypatch.setattr(node, "llm", RunnableLambda(lambda prompt: answer))
    events = []
    dw = DW()
    if physical is not None:

        async def schema():
            return physical

        dw.get_schema_columns = schema
    runtime = SimpleNamespace(
        context={"meta_mysql_repository": Meta(), "dw_mysql_repository": dw},
        stream_writer=events.append,
    )
    result = asyncio.run(node.assess_query({"query": query}, runtime))
    return result, events


def test_missing_evaluation_data_returns_explanation_without_sql(monkeypatch):
    data = ready(
        status="unsupported",
        reason="missing_data",
        message="当前数据源缺少商品评价或评分信息，无法计算客户满意度。",
        missing_information=["商品评价或评分信息"],
        metrics=[],
        required_columns=[],
        required_tables=[],
    )
    result, events = evaluate(monkeypatch, json.dumps(data, ensure_ascii=False))
    assert result["assessment"]["status"] == "unsupported"
    assert events[-1]["type"] == "assessment"
    assert events[-1]["missing_information"] == ["商品评价或评分信息"]
    assert "sql" not in result


def test_vague_sales_question_returns_specific_questions(monkeypatch):
    data = ready(
        status="clarify",
        reason="ambiguous_query",
        message="请补充时间范围和分析指标。",
        questions=["要查看哪个时间范围？", "关注销售额还是销量？"],
    )
    result, events = evaluate(
        monkeypatch, json.dumps(data, ensure_ascii=False), query="最近销售怎么样"
    )
    assert result["assessment"]["status"] == "clarify"
    assert len(events[-1]["questions"]) == 2


def test_actual_missing_column_cannot_pass_even_if_metadata_lists_it(monkeypatch):
    result, events = evaluate(
        monkeypatch,
        json.dumps(ready(), ensure_ascii=False),
        query="成交总额",
        physical={"fact_order": {"customer_id": "int"}},
    )
    assert result["assessment"]["status"] == "unsupported"
    assert events[-1]["missing_information"]


def test_invalid_model_json_fails_closed(monkeypatch):
    with pytest.raises(RuntimeError, match="可靠"):
        evaluate(monkeypatch, "this is not JSON")


@pytest.mark.parametrize(
    ("name", "label"), [("AOV", "平均订单金额"), ("复购率", "复购率平均值")]
)
def test_requesting_a_metric_or_its_average_is_not_providing_a_formula(name, label):
    usage = {
        "name": name,
        "source": "user_explicit",
        "metric_id": None,
        "definition": label,
        "evidence": label,
        "required_columns": ["fact_order.order_amount"],
    }
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[usage])), CATALOG, [label]
    )
    assert result.status == "clarify"


def test_explicit_formula_can_confirm_a_metric_via_its_configured_alias():
    formula = "平均订单金额=AVG(order_amount)"
    usage = {
        "name": "平均订单金额",
        "source": "user_explicit",
        "metric_id": None,
        "definition": formula,
        "evidence": formula,
        "required_columns": ["fact_order.order_amount"],
    }
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[usage])), CATALOG, ["查看 AOV", formula]
    )
    assert result.status == "ready"


@pytest.mark.parametrize("query", ["查看ROI", "统计利润"])
def test_business_metric_cannot_skip_definition_with_empty_metric_plan(query):
    result = validate_assessment(QueryAssessment(**ready(metrics=[])), CATALOG, [query])
    assert result.status == "clarify"


@pytest.mark.parametrize(
    ("status", "reason"), [("clarify", "clear"), ("unsupported", "undefined_metric")]
)
def test_business_status_requires_a_matching_reason(status, reason):
    with pytest.raises(ValidationError):
        QueryAssessment(
            **ready(
                status=status,
                reason=reason,
                message="需要补充信息",
                questions=["请提供公式？"],
                missing_information=["公式"],
            )
        )


def test_preflight_does_not_send_unrelated_record_samples_to_model(monkeypatch):
    catalog = copy.deepcopy(CATALOG)
    catalog["tables"][0]["columns"][2]["examples"] = [987654321]

    async def read(self):
        return catalog

    monkeypatch.setattr(Meta, "get_query_catalog", read)
    seen = []

    def answer(prompt):
        seen.append(prompt.to_string())
        return json.dumps(ready(), ensure_ascii=False)

    monkeypatch.setattr(node, "llm", RunnableLambda(answer))
    runtime = SimpleNamespace(
        context={"meta_mysql_repository": Meta(), "dw_mysql_repository": DW()},
        stream_writer=lambda event: None,
    )
    state = asyncio.run(node.assess_query({"query": "成交总额"}, runtime))
    assert state["assessment"]["status"] == "ready"
    assert "987654321" not in seen[0]
    assert "客户标识" in seen[0]


def test_explicit_relative_month_has_a_trusted_system_date(monkeypatch):
    from datetime import date

    catalog = copy.deepcopy(CATALOG)
    catalog["tables"][0]["columns"].append(
        {
            "id": "fact_order.order_date",
            "name": "order_date",
            "type": "date",
            "role": "dimension",
            "description": "下单日期",
            "alias": ["订单日期"],
            "examples": [],
        }
    )

    async def read(self):
        return catalog

    async def schema(self):
        return {
            "fact_order": {
                column["name"]: column["type"]
                for column in catalog["tables"][0]["columns"]
            }
        }

    monkeypatch.setattr(Meta, "get_query_catalog", read)
    monkeypatch.setattr(DW, "get_schema_columns", schema)
    seen = []

    def answer(prompt):
        seen.append(prompt.to_string())
        return json.dumps(
            ready(
                resolved_query="统计本月成交总额",
                required_columns=["fact_order.order_amount", "fact_order.order_date"],
            ),
            ensure_ascii=False,
        )

    monkeypatch.setattr(node, "llm", RunnableLambda(answer))
    runtime = SimpleNamespace(
        context={"meta_mysql_repository": Meta(), "dw_mysql_repository": DW()},
        stream_writer=lambda event: None,
    )
    asyncio.run(node.assess_query({"query": "统计本月成交总额"}, runtime))
    assert date.today().isoformat() in seen[0]


def test_configured_metric_cannot_impersonate_an_undefined_metric():
    data = ready()
    data["metrics"][0]["name"] = "ROI"
    result = validate_assessment(QueryAssessment(**data), CATALOG, ["查看 ROI"])
    assert result.status == "clarify"
    assert "ROI" in result.message


def test_formula_cannot_hide_absent_field_by_omitting_dependency():
    formula = "毛利率=(order_amount-cost_amount)/order_amount"
    usage = {
        "name": "毛利率",
        "source": "user_explicit",
        "metric_id": None,
        "definition": formula,
        "evidence": formula,
        "required_columns": ["fact_order.order_amount"],
    }
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[usage])), CATALOG, [formula]
    )
    assert result.status == "unsupported"
    assert "cost_amount" in result.message


def test_explicit_formula_dependencies_are_kept_even_if_model_omits_one():
    formula = "单件金额=order_amount/order_quantity"
    usage = {
        "name": "单件金额",
        "source": "user_explicit",
        "metric_id": None,
        "definition": formula,
        "evidence": formula,
        "required_columns": ["fact_order.order_amount"],
    }
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[usage])), CATALOG, [formula]
    )
    assert result.status == "ready"
    assert "fact_order.order_quantity" in result.required_columns
    assert "fact_order.order_quantity" in result.metrics[0].required_columns


def test_unmapped_natural_formula_operands_need_clarification():
    formula = "复购率=复购客户数/客户总数"
    usage = {
        "name": "复购率",
        "source": "user_explicit",
        "metric_id": None,
        "definition": formula,
        "evidence": formula,
        "required_columns": ["fact_order.customer_id"],
    }
    result = validate_assessment(
        QueryAssessment(**ready(metrics=[usage])), CATALOG, [formula]
    )
    assert result.status == "clarify"
    assert "复购客户数" in result.message


def test_known_profit_field_can_be_read_as_detail_without_metric_definition():
    catalog = copy.deepcopy(CATALOG)
    catalog["tables"][0]["columns"].append(
        {
            "id": "fact_order.profit",
            "name": "profit",
            "type": "decimal",
            "role": "measure",
            "description": "已存储的订单利润",
            "alias": ["利润"],
            "examples": [],
        }
    )
    query = "列出所有订单记录的利润"
    result = validate_assessment(
        QueryAssessment(
            **ready(
                metrics=[], resolved_query=query, required_columns=["fact_order.profit"]
            )
        ),
        catalog,
        [query],
    )
    assert result.status == "ready"


def test_unknown_metric_reply_does_not_propose_a_guessed_formula():
    data = ready(
        status="clarify",
        reason="undefined_metric",
        message="复购率是不是按本月下单至少2次的客户数除以本月客户数？",
        questions=["分子用本月下单≥2的客户数吗？"],
        missing_information=["复购率计算方式"],
    )
    result = validate_assessment(QueryAssessment(**data), CATALOG, ["统计本月复购率"])
    assert result.status == "clarify"
    content = json.dumps(result.reply(), ensure_ascii=False)
    assert "复购率" in content
    assert "≥2" not in content and "至少2次" not in content
