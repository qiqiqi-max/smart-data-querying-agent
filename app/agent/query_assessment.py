"""Validated query intent and metric evidence, independent of SQL generation."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlglot import exp, parse
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import traverse_scope


class MetricUse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: str = Field(min_length=1, max_length=128)
    source: Literal["configured", "user_explicit"]
    metric_id: str | None = None
    definition: str = Field(min_length=1, max_length=2000)
    evidence: str = Field(default="", max_length=2000)
    required_columns: list[str] = Field(default_factory=list, max_length=100)


class QueryAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: Literal["ready", "clarify", "unsupported"]
    reason: Literal[
        "clear",
        "ambiguous_query",
        "missing_data",
        "undefined_metric",
        "inconsistent_metric",
    ]
    message: str = Field(default="", max_length=2000)
    questions: list[str] = Field(default_factory=list, max_length=3)
    missing_information: list[str] = Field(default_factory=list, max_length=20)
    resolved_query: str = Field(default="", max_length=3500)
    required_tables: list[str] = Field(default_factory=list, max_length=50)
    required_columns: list[str] = Field(default_factory=list, max_length=100)
    metrics: list[MetricUse] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def require_actionable_decision(self):
        if self.status == "clarify" and self.reason not in {
            "ambiguous_query",
            "undefined_metric",
            "inconsistent_metric",
        }:
            raise ValueError("追问状态必须对应未明确的问题或口径")
        if self.status == "unsupported" and self.reason != "missing_data":
            raise ValueError("数据不足状态必须明确对应缺少的数据")
        if self.status == "ready":
            if (
                self.reason != "clear"
                or not self.resolved_query.strip()
                or not self.required_tables
            ):
                raise ValueError("可查询意图必须明确，且引用真实数据表")
            if self.questions or self.missing_information:
                raise ValueError("存在未解问题时不能生成 SQL")
        elif not self.message.strip():
            raise ValueError("业务回复必须说明原因")
        if self.status == "clarify" and not any(
            question.strip() for question in self.questions
        ):
            raise ValueError("需要至少一个具体追问")
        if self.status == "unsupported" and not any(
            item.strip() for item in self.missing_information
        ):
            raise ValueError("必须说明缺少什么信息")
        return self

    def reply(self) -> dict:
        return self.model_dump(
            include={"status", "reason", "message", "questions", "missing_information"}
        )


def _normalize(value: str) -> str:
    return re.sub(r"\s+", "", value).casefold()


def _clarify(name: str, reason: str, detail: str) -> QueryAssessment:
    return QueryAssessment(
        status="clarify",
        reason=reason,
        message=f"{name}的口径尚不能确认：{detail}。确认后才能计算。",
        questions=[
            f"请明确{name}的计算公式、统计范围和必要的筛选条件；若已有业务定义，请先确认该定义及依赖字段。"
        ],
        missing_information=[detail],
    )


def _missing(items: list[str]) -> QueryAssessment:
    return QueryAssessment(
        status="unsupported",
        reason="missing_data",
        message="当前已接入的数据源缺少以下信息，无法回答本次问题："
        + "、".join(items)
        + "。",
        missing_information=items,
    )


def verified_catalog(catalog: dict, schema: dict[str, dict[str, str]]) -> dict:
    """Never mistake a retrieval miss for a missing field; verify the full catalog."""
    tables, unavailable = [], {}
    for table in catalog["tables"]:
        actual = schema.get(table["name"], {})
        columns = []
        for column in table["columns"]:
            if column["name"] in actual:
                columns.append({**column, "type": actual[column["name"]]})
            else:
                unavailable[column["id"]] = column.get("description") or column["name"]
        if columns:
            tables.append({**table, "columns": columns})
    return {
        "tables": tables,
        "metrics": catalog["metrics"],
        "unavailable_columns": unavailable,
    }


def _has_calculation(text: str) -> bool:
    return bool(
        re.search(
            r"总和|之和|求和|总额|平均|均值|总数|个数|计数|除以|相除|乘以|减去|相减|相加|[=＝/÷*×+]|\b(?:SUM|AVG|COUNT)\b",
            text,
            re.I,
        )
    )


def _is_explicit_calculation(definition: str, columns: dict) -> bool:
    """A metric label, even one containing 'average', is not its definition."""
    if re.search(r"https?://|www\.", definition, re.I):
        return False
    expression = re.split(r"[=＝]", definition, maxsplit=1)[-1].strip()
    if not expression:
        return False
    if re.search(r".+(?:除以|相除|乘以|减去|相减|相加|[/÷*×+]).+", expression):
        return True
    if re.search(r".+占.+(?:比例|比重)", expression):
        return True
    labels = {
        label
        for column in columns.values()
        for label in [column["name"], column["id"], *column.get("alias", [])]
    }
    labels.update(
        column["description"]
        for column in columns.values()
        if 0 < len(column.get("description", "")) <= 20
    )
    if re.search(r"\b(?:SUM|AVG|COUNT)\s*\(", expression, re.I) and any(
        label in expression for label in labels
    ):
        return True
    if ("=" in definition or "＝" in definition) and expression in labels:
        return True
    return any(
        re.search(
            re.escape(label)
            + r"(?:的)?(?:求|取|计算)?(?:平均值|平均|均值|总和|之和|总数|个数)",
            expression,
        )
        for label in labels
    )


def _formula_dependencies(
    usage: MetricUse, columns: dict
) -> tuple[list[str], list[str], list[str]]:
    """Resolve every operand; do not trust a model's incomplete dependency list."""
    expression = re.split(r"[=＝]", usage.definition, maxsplit=1)[-1].strip()
    expression = re.sub(r"^(?:对|所有|全部|现有)+", "", expression)
    for column_id, column in columns.items():
        labels = [column["name"], *column.get("alias", [])]
        if len(column.get("description", "")) <= 20:
            labels.append(column.get("description", ""))
        for label in sorted(set(labels), key=len, reverse=True):
            if not label:
                continue
            expression = re.sub(
                re.escape(label) + r"(?:的)?(?:求|取)?(?:平均值|平均|均值)",
                f"AVG({column_id})",
                expression,
            )
            expression = re.sub(
                re.escape(label) + r"(?:的)?(?:求|取)?(?:总和|之和)",
                f"SUM({column_id})",
                expression,
            )
    expression = (
        expression.replace("除以", "/")
        .replace("乘以", "*")
        .replace("减去", "-")
        .replace("相加", "+")
    )
    try:
        parsed = parse(expression, read="mysql")
        if len(parsed) != 1 or parsed[0] is None:
            return [], [], ["完整计算说明与具体数据字段的对应关系"]
        references = list(parsed[0].find_all(exp.Column))
    except Exception:
        return [], [], ["完整计算说明与具体数据字段的对应关系"]
    resolved, absent, unmapped = [], [], []
    for reference in references:
        matches = [
            column_id
            for column_id, column in columns.items()
            if _normalize(reference.name)
            in {
                _normalize(column["name"]),
                *(_normalize(alias) for alias in column.get("alias", [])),
            }
            and (
                not reference.table
                or column_id.split(".")[0].casefold() == reference.table.casefold()
            )
        ]
        declared = [name for name in matches if name in usage.required_columns]
        if len(matches) == 1:
            resolved.append(matches[0])
        elif len(declared) == 1:
            resolved.append(declared[0])
        elif not matches and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", reference.name):
            absent.append(reference.sql(dialect="mysql"))
        else:
            unmapped.append(reference.sql(dialect="mysql"))
    return list(dict.fromkeys(resolved)), absent, unmapped


def _raw_field_request(
    name: str, assessment: QueryAssessment, columns: dict, user_statements: list[str]
) -> bool:
    text = "\n".join(user_statements)
    explicit_detail = bool(
        re.search(r"列出|显示|展示|读取|返回|查看", text)
        and re.search(r"明细|记录|原值|字段|原始", text)
    )
    if not explicit_detail or re.search(r"汇总|求和|平均|计算|同比|环比|增长", text):
        return False
    return any(
        label and _normalize(label) in _normalize(name)
        for column_id in assessment.required_columns
        if column_id in columns
        for label in [columns[column_id]["name"], *columns[column_id].get("alias", [])]
    )


def _dependency_conflict(metric: dict, columns: dict) -> str | None:
    definition = metric.get("description") or ""
    dependency_text = " ".join(
        " ".join(
            [
                column.get("name", ""),
                column.get("description", ""),
                *column.get("alias", []),
            ]
        )
        for column_id in metric.get("relevant_columns") or []
        if (column := columns.get(column_id))
    )
    # These are dimensional conflicts, not an attempt to infer a replacement formula.
    if "金额" in definition and not re.search(
        r"金额|销售额|收入|成本|amount|revenue|cost", dependency_text, re.I
    ):
        return "定义使用金额，但已配置依赖字段没有金额信息"
    if "数量" in definition and not re.search(
        r"数量|销量|件数|quantity|count", dependency_text, re.I
    ):
        return "定义使用数量，但已配置依赖字段没有数量信息"
    return None


def validate_assessment(
    assessment: QueryAssessment, catalog: dict, user_statements: list[str]
) -> QueryAssessment:
    columns = {
        column["id"]: column
        for table in catalog["tables"]
        for column in table["columns"]
    }
    if assessment.status != "ready":
        if assessment.status == "clarify" and assessment.reason == "undefined_metric":
            text = "\n".join(user_statements)
            names = re.findall(
                r"(?<![A-Za-z0-9_])(?:ROI|LTV|AOV|GMV)(?![A-Za-z0-9_])|[\u4e00-\u9fff]{0,6}(?:率|客单价|利润|毛利|净利)",
                text,
                re.I,
            )
            names = [
                re.sub(
                    r"^(?:请|帮我|看看|查看|统计|计算|查询|本月|本季度|今年|所有|全部)+",
                    "",
                    name,
                )
                for name in names
            ]
            label = "、".join(dict.fromkeys(names)) or "所查询的指标"
            return _clarify(
                label,
                "undefined_metric",
                "尚未提供经过确认的计算方式、统计对象和必要的业务规则",
            )
        if assessment.status == "unsupported":
            available_labels = {
                label
                for column in columns.values()
                for label in [column["name"], *column.get("alias", [])]
            }
            if any(item in available_labels for item in assessment.missing_information):
                return QueryAssessment(
                    status="clarify",
                    reason="ambiguous_query",
                    message="数据源已有相关字段，请进一步明确你需要的计算和范围。",
                    questions=["请说明具体的指标、统计范围和计算方式。"],
                )
        return assessment
    table_names = {table["name"] for table in catalog["tables"]}
    unavailable = catalog.get("unavailable_columns", {})
    unknown = [name for name in assessment.required_tables if name not in table_names]
    unknown += [
        unavailable.get(name, name)
        for name in assessment.required_columns
        if name not in columns
    ]
    if unknown:
        return _missing(list(dict.fromkeys(unknown)))
    configured = {metric["id"]: metric for metric in catalog["metrics"]}
    required = list(assessment.required_columns)
    for usage in assessment.metrics:
        if usage.source == "configured":
            metric = configured.get(usage.metric_id)
            if metric is None:
                return _clarify(
                    usage.name, "undefined_metric", "数据源未配置这个指标的业务定义"
                )
            identities = {
                _normalize(metric["name"]),
                *(_normalize(alias) for alias in metric.get("alias", [])),
            }
            if _normalize(usage.name) not in identities:
                return _clarify(
                    usage.name,
                    "undefined_metric",
                    f"提供的配置实际属于{metric['name']}，不能用作这个指标的定义",
                )
            usage.name = metric["name"]
            definition = metric.get("description") or ""
            dependencies = metric.get("relevant_columns") or []
            if (
                not definition.strip()
                or not _has_calculation(definition)
                or not dependencies
            ):
                return _clarify(
                    metric["name"],
                    "undefined_metric",
                    "已有说明没有明确计算方式或依赖字段",
                )
            if _normalize(usage.definition) != _normalize(definition):
                return _clarify(
                    metric["name"],
                    "inconsistent_metric",
                    "提出的计算与已配置业务定义不一致",
                )
            if set(usage.required_columns) != set(dependencies):
                return _clarify(
                    metric["name"],
                    "inconsistent_metric",
                    "提出的计算字段与指标配置的依赖字段不一致",
                )
            if missing := [name for name in dependencies if name not in columns]:
                return _missing([unavailable.get(name, name) for name in missing])
            if conflict := _dependency_conflict(metric, columns):
                return _clarify(metric["name"], "inconsistent_metric", conflict)
        else:
            evidence = usage.evidence.strip()
            if (
                not evidence
                or not any(evidence in statement for statement in user_statements)
                or _normalize(usage.definition) not in _normalize(evidence)
                or not _is_explicit_calculation(usage.definition, columns)
            ):
                return _clarify(
                    usage.name, "undefined_metric", "缺少客户明确提供的计算公式与口径"
                )
            if missing := [
                name for name in usage.required_columns if name not in columns
            ]:
                return _missing(missing)
            if not usage.required_columns:
                return _clarify(
                    usage.name, "undefined_metric", "计算没有明确可使用的数据字段"
                )
            dependencies, absent, unmapped = _formula_dependencies(usage, columns)
            if absent:
                return _missing(absent)
            if unmapped:
                return _clarify(
                    usage.name,
                    "undefined_metric",
                    "公式中的" + "、".join(unmapped) + "尚未明确如何对应或计算现有数据",
                )
            usage.required_columns = list(
                dict.fromkeys([*usage.required_columns, *dependencies])
            )
        required.extend(usage.required_columns)
    # A named business metric cannot be silently reduced to an unrelated SUM/COUNT.
    text = "\n".join(user_statements)
    requested = re.findall(
        r"(?<![A-Za-z0-9_])(?:GMV|AOV|ROI|LTV)(?![A-Za-z0-9_])|[\u4e00-\u9fff]{0,6}(?:率|满意度|客单价|利润|毛利|净利)",
        text,
        re.I,
    )
    for name in requested:
        if _raw_field_request(name, assessment, columns, user_statements):
            continue
        covered = any(
            usage.name.casefold() in name.casefold()
            or any(
                alias in name
                for alias in (configured.get(usage.metric_id) or {}).get("alias", [])
            )
            for usage in assessment.metrics
        )
        if not covered:
            covered = any(
                _normalize(usage.name)
                in {
                    _normalize(metric["name"]),
                    *(_normalize(alias) for alias in metric.get("alias", [])),
                }
                and (
                    _normalize(metric["name"]) in _normalize(name)
                    or any(
                        _normalize(alias) in _normalize(name)
                        for alias in metric.get("alias", [])
                    )
                )
                for usage in assessment.metrics
                for metric in catalog["metrics"]
            )
        if not covered:
            return _clarify(
                name, "undefined_metric", "没有经过确认的指标定义，不能自行假定计算方法"
            )
    return assessment.model_copy(
        update={
            "required_columns": list(dict.fromkeys(required)),
            "required_tables": list(
                dict.fromkeys(
                    [
                        *assessment.required_tables,
                        *(name.split(".")[0] for name in required),
                    ]
                )
            ),
        }
    )


def check_sql_context(
    sql: str,
    tables: list[dict],
    required_columns: list[str] | None = None,
    database: str | None = None,
) -> None:
    """Validate real identifiers and the fields approved as necessary by the check."""
    schema = {
        table["name"].casefold(): {
            column["name"]: column.get("type") or "UNKNOWN"
            for column in table["columns"]
        }
        for table in tables
    }
    try:
        statements = parse(sql, read="mysql")
        if len(statements) != 1 or not isinstance(statements[0], exp.Query):
            raise ValueError("只允许单条只读查询")
        tree = statements[0]
        found_tables = set()
        for scope in traverse_scope(tree):
            for source in scope.sources.values():
                if not isinstance(source, exp.Table):
                    continue  # A CTE/derived table is checked through its own inner scope.
                if source.name.casefold() not in schema:
                    raise ValueError(f"SQL 引用了未确认的数据表：{source.name}")
                if source.catalog or (
                    source.db
                    and (
                        database is None or source.db.casefold() != database.casefold()
                    )
                ):
                    raise ValueError("SQL 只能查询本次已确认的数据源")
                found_tables.add(source.name.casefold())
        if not found_tables:
            raise ValueError("SQL 没有查询已确认的数据表")
        qualified = qualify(
            tree,
            dialect="mysql",
            schema=schema,
            infer_schema=False,
            quote_identifiers=False,
            validate_qualify_columns=True,
        )
        used = set()
        for scope in traverse_scope(qualified):
            for column in scope.columns:
                source = scope.sources.get(column.table)
                if isinstance(source, exp.Table):
                    used.add(f"{source.name}.{column.name}".casefold())
        if missing := [
            name for name in required_columns or [] if name.casefold() not in used
        ]:
            raise ValueError("SQL 未使用已确认的必要字段：" + "、".join(missing))
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError(f"SQL 字段与已确认的元数据不一致：{exc}") from exc
