"""SQL 校验失败收口节点。"""

from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.state import DataAgentState
from app.core.log import logger


async def fail_sql(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    """达到最大修正次数后，明确结束流程且不执行 SQL。"""
    step = "SQL校验失败"
    message = state.get("error") or "SQL 校验失败，已达到最大修正次数"
    runtime.stream_writer(
        {
            "type": "progress",
            "step": step,
            "status": "error",
            "message": message,
        }
    )
    # 带上最后一次未通过校验的 SQL，方便在前端和历史记录里排查
    runtime.stream_writer(
        {"type": "error", "message": message, "sql": state.get("sql")}
    )
    logger.error("SQL 校验达到最大修正次数：{}", message)
    return {"error": message}
