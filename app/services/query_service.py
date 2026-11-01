"""
问数查询服务

负责把 API 层传入的自然语言问题转换成一次 LangGraph 工作流执行：
创建初始 State、组装 Runtime Context、消费 graph.astream 的流式输出，
并统一包装成 SSE 文本返回给路由层。
"""

import asyncio
import json
import uuid
from contextlib import aclosing

import anyio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent.context import DataAgentContext
from app.agent.graph import graph
from app.agent.state import DataAgentState
from app.clients.embedding_client import EmbeddingClient
from app.core.log import logger
from app.repositories.es.value_es_repository import ValueESRepository
from app.repositories.mysql.dw.dw_mysql_repository import DWMySQLRepository
from app.repositories.mysql.meta.meta_mysql_repository import MetaMySQLRepository
from app.repositories.mysql.meta.query_history_repository import QueryHistoryRepository
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository
from app.repositories.qdrant.metric_qdrant_repository import MetricQdrantRepository
from app.services.demo_query_service import run_demo_query
from app.services.result_summary import summarize_result

# 整条问数链路的服务端超时
QUERY_TIMEOUT_SECONDS = 120
# 客户端断开后写回中断状态的最长等待时间
INTERRUPT_WRITE_TIMEOUT_SECONDS = 5


class QueryService:
    """封装一次问数查询所需的业务编排逻辑"""

    def __init__(
        self,
        meta_mysql_repository: MetaMySQLRepository,
        embedding_client: EmbeddingClient,
        dw_mysql_repository: DWMySQLRepository,
        column_qdrant_repository: ColumnQdrantRepository,
        metric_qdrant_repository: MetricQdrantRepository,
        value_es_repository: ValueESRepository,
        query_history_repository: QueryHistoryRepository,
        meta_session_factory: async_sessionmaker[AsyncSession],
        demo_mode: bool = False,
    ):
        # MySQL 仓储分别负责元数据补全和真实数仓环境信息读取
        self.meta_mysql_repository = meta_mysql_repository
        self.dw_mysql_repository = dw_mysql_repository

        # 召回链路依赖的向量检索、Embedding 和全文检索能力由依赖层注入
        self.embedding_client = embedding_client
        self.column_qdrant_repository = column_qdrant_repository
        self.metric_qdrant_repository = metric_qdrant_repository
        self.value_es_repository = value_es_repository
        self.query_history_repository = query_history_repository
        # 客户端断开时请求级 Session 可能停在半途，收尾写入改用独立 Session
        self.meta_session_factory = meta_session_factory
        self.demo_mode = demo_mode

    async def query(self, query: str):
        """执行一次问数工作流，并逐段产出 SSE 消息"""

        history_id = str(uuid.uuid4())
        await self.query_history_repository.create(history_id, query)

        # aclosing 保证提前退出时内层生成器和 graph.astream 被及时关闭，不再调度后续节点
        async with aclosing(self._run(query, history_id)) as chunks:
            try:
                async for chunk in chunks:
                    yield chunk
            except asyncio.CancelledError, GeneratorExit:
                # 前端停止查询或连接断开时，生成器会被取消或关闭，记录需要从 running 收尾
                await self._mark_interrupted(history_id)
                raise

    async def _mark_interrupted(self, history_id: str):
        """在取消状态下把运行记录标记为已停止，失败时交给启动清理兜底"""

        # 当前任务已被取消，必须屏蔽取消才能完成这次写入，同时限制最长等待时间
        with anyio.move_on_after(INTERRUPT_WRITE_TIMEOUT_SECONDS, shield=True) as scope:
            try:
                async with self.meta_session_factory() as session:
                    await QueryHistoryRepository(session).mark_interrupted(history_id)
            except Exception:
                logger.exception("标记查询中断失败：{}", history_id)
        if scope.cancelled_caught:
            logger.warning("标记查询中断超时：{}", history_id)

    async def _run(self, query: str, history_id: str):
        """按运行模式执行问数链路，并逐段产出 SSE 消息"""

        if self.demo_mode:
            async for chunk in run_demo_query(
                query=query,
                history_id=history_id,
                query_history_repository=self.query_history_repository,
                dw_mysql_repository=self.dw_mysql_repository,
            ):
                yield chunk
            return

        # State 只放会被图节点读写和合并的业务数据，外部工具对象不塞进 State
        state = DataAgentState(query=query)
        # Context 保存本次图执行需要复用的外部依赖，节点通过 runtime.context 读取
        context = DataAgentContext(
            column_qdrant_repository=self.column_qdrant_repository,
            embedding_client=self.embedding_client,
            metric_qdrant_repository=self.metric_qdrant_repository,
            value_es_repository=self.value_es_repository,
            meta_mysql_repository=self.meta_mysql_repository,
            dw_mysql_repository=self.dw_mysql_repository,
        )
        has_result = False
        has_error = False
        try:
            # stream_mode="custom" 对应节点内部 writer(...) 写出的进度消息
            async with (
                asyncio.timeout(QUERY_TIMEOUT_SECONDS),
                aclosing(
                    graph.astream(input=state, context=context, stream_mode="custom")
                ) as stream,
            ):
                async for chunk in stream:
                    if chunk.get("type") == "result":
                        has_result = True
                        data = chunk.get("data")
                        summary = summarize_result(data)
                        await self.query_history_repository.mark_done(
                            history_id, data, summary
                        )
                    elif chunk.get("type") == "error":
                        has_error = True
                        await self.query_history_repository.mark_error(
                            history_id, str(chunk.get("message", "查询失败"))
                        )

                    # SSE 要求每条消息以 data: 开头，并以两个换行符结束
                    yield f"data: {json.dumps(chunk, ensure_ascii=False, default=str)}\n\n"

            if not has_result and not has_error:
                message = "流程结束但未返回查询结果"
                await self.query_history_repository.mark_error(history_id, message)
                error = {"type": "error", "message": message}
                yield f"data: {json.dumps(error, ensure_ascii=False)}\n\n"
        except Exception as e:
            # 真实模式下保留原始错误，不自动降级到演示模式。
            # asyncio 超时异常没有文本，需要单独给出可读的提示
            if isinstance(e, TimeoutError):
                message = (
                    f"查询超时（超过 {QUERY_TIMEOUT_SECONDS} 秒），请缩小查询范围后重试"
                )
            else:
                message = str(e) or type(e).__name__
            await self.query_history_repository.mark_error(history_id, message)
            error = {"type": "error", "message": message}
            yield f"data: {json.dumps(error, ensure_ascii=False, default=str)}\n\n"
