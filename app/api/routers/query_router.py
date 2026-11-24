"""
问数查询接口路由

负责定义前端访问的 `/api/query` 接口，把 HTTP 请求交给 QueryService，
并把问数智能体执行过程以 SSE 形式持续返回给客户端。
路由层只处理请求体、依赖声明和响应类型，不直接创建 Repository 或执行图节点。
"""

from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from app.api.dependencies import get_query_history_repository, get_query_service
from app.api.schemas.query_history_schema import (
    QueryHistoryItem,
    QueryHistorySummaryItem,
)
from app.api.schemas.query_schema import QuerySchema
from app.core.maintenance import maintenance
from app.repositories.mysql.meta.query_history_repository import (
    QueryHistoryRepository,
    QueryHistoryRunningError,
)
from app.services.query_clarification import ClarificationError
from app.services.query_service import QueryService

# 当前模块只维护查询相关接口，避免后续所有 API 都挤在 main.py 中
query_router = APIRouter()

# 关闭生成器时等待收尾逻辑的最长时间
STREAM_CLOSE_TIMEOUT_SECONDS = 10


class ClosingStreamingResponse(StreamingResponse):
    """响应结束后显式关闭生成器，客户端断开时也能执行生成器的收尾逻辑"""

    def __init__(self, *args, on_close=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_close = on_close

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Starlette 检测到断开时只取消发送任务，不关闭 body_iterator，
            # 生成器会停在 yield 处，直到被垃圾回收才执行收尾
            try:
                aclose = getattr(self.body_iterator, "aclose", None)
                if aclose is not None:
                    with anyio.move_on_after(STREAM_CLOSE_TIMEOUT_SECONDS, shield=True):
                        await aclose()
            finally:
                if self.on_close is not None:
                    self.on_close()


@query_router.post("/api/query")
async def query_handler(
    # 请求体参数：FastAPI 会把前端 JSON 自动解析成 QuerySchema
    query: QuerySchema,
    # 服务依赖：FastAPI 会调用 get_query_service，递归组装它所需的仓储和客户端
    query_service: Annotated[QueryService, Depends(get_query_service)],
):
    """接收用户自然语言问题，并流式返回 LangGraph 工作流输出"""

    clarification_context = None
    if query.parent_history_id:
        try:
            clarification_context = await query_service.prepare_clarification(
                query.parent_history_id, query.query
            )
        except ClarificationError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc

    release = maintenance.reserve_query()

    async def guarded_query():
        from contextlib import aclosing

        query_stream = (
            query_service.query(
                query.query, clarification_context=clarification_context
            )
            if clarification_context
            else query_service.query(query.query)
        )
        async with aclosing(query_stream) as stream:
            async for chunk in stream:
                yield chunk

    return ClosingStreamingResponse(
        # query.query 是用户问题字符串；QueryService.query 返回异步生成器供响应逐段消费
        guarded_query(),
        media_type="text/event-stream",
        on_close=release,
    )


@query_router.get("/api/query/history", response_model=list[QueryHistorySummaryItem])
async def query_history_handler(
    query_history_repository: Annotated[
        QueryHistoryRepository, Depends(get_query_history_repository)
    ],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    """读取最近问数记录"""

    histories = await query_history_repository.list_recent(limit)
    return [
        QueryHistorySummaryItem.model_validate(history, from_attributes=True)
        for history in histories
    ]


@query_router.get("/api/query/history/{history_id}", response_model=QueryHistoryItem)
async def query_history_detail_handler(
    history_id: str,
    query_history_repository: Annotated[
        QueryHistoryRepository, Depends(get_query_history_repository)
    ],
):
    """打开历史记录时读取完整结果。"""
    history = await query_history_repository.get_by_id(history_id)
    if history is None:
        raise HTTPException(status_code=404, detail="查询记录不存在")
    return QueryHistoryItem.model_validate(history, from_attributes=True)


@query_router.delete("/api/query/history/{history_id}", status_code=204)
async def delete_query_history_handler(
    history_id: str,
    query_history_repository: Annotated[
        QueryHistoryRepository, Depends(get_query_history_repository)
    ],
):
    """删除一条查询历史记录。"""
    try:
        deleted = await query_history_repository.delete(history_id)
    except QueryHistoryRunningError:
        raise HTTPException(status_code=409, detail="查询仍在运行，不能删除")
    if not deleted:
        raise HTTPException(status_code=404, detail="查询记录不存在")
