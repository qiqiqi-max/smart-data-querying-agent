"""Check answerability against complete verified metadata before any SQL work."""

import json
from datetime import date

from langchain_core.exceptions import OutputParserException
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import PromptTemplate
from langgraph.runtime import Runtime
from pydantic import ValidationError

from app.agent.context import DataAgentContext
from app.agent.llm import llm
from app.agent.query_assessment import (
    QueryAssessment,
    validate_assessment,
    verified_catalog,
)
from app.agent.state import DataAgentState
from app.prompt.prompt_loader import load_prompt


async def assess_query(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    writer = runtime.stream_writer
    step = "检查问题与数据"
    writer({"type": "progress", "step": step, "status": "running"})
    try:
        raw_catalog = await runtime.context["meta_mysql_repository"].get_query_catalog()
        schema = await runtime.context["dw_mysql_repository"].get_schema_columns()
        catalog = verified_catalog(raw_catalog, schema)
        today = date.today()
        date_info = {
            "date": today.isoformat(),
            "weekday": today.strftime("%A"),
            "quarter": f"Q{(today.month - 1) // 3 + 1}",
        }
        context = state.get("clarification_context") or {
            "original_query": state["query"],
            "turns": [],
        }
        user_statements = [
            context["original_query"],
            *(turn["answer"] for turn in context["turns"]),
        ]
        if not catalog["tables"]:
            assessment = QueryAssessment(
                status="unsupported",
                reason="missing_data",
                message="当前数据源没有已接入且可用的表结构，请先配置元数据并构建知识库。",
                missing_information=["已接入且与数据库一致的表结构和字段元数据"],
            )
        else:
            prompt = PromptTemplate(
                template=load_prompt("assess_query"),
                input_variables=["catalog", "question", "context", "date_info"],
            )
            prompt_catalog = {
                **catalog,
                "tables": [
                    {
                        **table,
                        "columns": [
                            {
                                key: value
                                for key, value in column.items()
                                if key != "examples"
                            }
                            for column in table["columns"]
                        ],
                    }
                    for table in catalog["tables"]
                ],
            }
            chain = prompt | llm | JsonOutputParser()
            result = await chain.ainvoke(
                {
                    "catalog": json.dumps(
                        prompt_catalog, ensure_ascii=False, default=str
                    ),
                    "question": state["query"],
                    "context": json.dumps(context, ensure_ascii=False),
                    "date_info": json.dumps(date_info, ensure_ascii=False),
                }
            )
            assessment = validate_assessment(
                QueryAssessment.model_validate(result), catalog, user_statements
            )
        writer({"type": "progress", "step": step, "status": "success"})
        if assessment.status != "ready":
            writer({"type": "assessment", **assessment.reply()})
        return {
            "assessment": assessment.model_dump(),
            "query": assessment.resolved_query
            if assessment.status == "ready"
            else state["query"],
            "query_catalog": catalog,
            "date_info": date_info,
        }
    except (OutputParserException, ValidationError) as exc:
        writer({"type": "progress", "step": step, "status": "error"})
        raise RuntimeError(
            "暂时无法可靠理解这个问题，请补充完整问题或稍后重试。"
        ) from exc
    except Exception:
        writer({"type": "progress", "step": step, "status": "error"})
        raise
