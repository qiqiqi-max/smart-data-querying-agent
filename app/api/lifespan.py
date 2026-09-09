"""
FastAPI 应用生命周期管理

负责在服务启动时初始化外部客户端，在服务关闭时释放连接资源。
这些客户端是应用级资源，适合在 lifespan 中创建一次并复用，而不是每个请求
重复初始化。
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.clients.embedding_client_manager import embedding_client_manager
from app.clients.es_client_manager import es_client_manager
from app.clients.mysql_client_manager import (
    dw_mysql_client_manager,
    meta_mysql_client_manager,
)
from app.clients.qdrant_client_manager import qdrant_client_manager
from app.conf.app_config import app_config
from app.core.log import logger
from app.models.query_history import QueryHistoryMySQL
from app.repositories.es.value_es_repository import ValueESRepository
from app.repositories.mysql.meta.query_history_repository import QueryHistoryRepository
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository
from app.repositories.qdrant.metric_qdrant_repository import MetricQdrantRepository


@asynccontextmanager
async def lifespan(app: FastAPI):
    """管理应用启动和关闭两个阶段的外部资源"""

    # 启动阶段：先建立各类外部服务客户端，后续依赖函数会从 manager 中取已初始化对象
    qdrant_client_manager.init()
    if qdrant_client_manager.client is None:
        logger.warning("Qdrant 客户端初始化失败")

    embedding_client_manager.init()
    if embedding_client_manager.client is None:
        logger.warning("Embedding 客户端初始化失败")

    es_client_manager.init()
    if es_client_manager.client is None and not app_config.local_mode:
        logger.warning("Elasticsearch 客户端初始化失败")

    meta_mysql_client_manager.init()
    dw_mysql_client_manager.init()

    async with meta_mysql_client_manager.engine.begin() as connection:
        await connection.run_sync(QueryHistoryMySQL.__table__.create, checkfirst=True)

    async with meta_mysql_client_manager.session_factory() as session:
        await QueryHistoryRepository(session).mark_stale_running()

    if not app_config.demo_mode:
        missing: list[str] = []
        if app_config.local_mode:
            # 本地模式使用 Qdrant 的嵌入式存储和本地字段值索引，不依赖外部端口。
            try:
                if qdrant_client_manager.client is None:
                    missing.append("本地 Qdrant")
                else:
                    await ColumnQdrantRepository(
                        qdrant_client_manager.client
                    ).ensure_collection()
                    await MetricQdrantRepository(
                        qdrant_client_manager.client
                    ).ensure_collection()
            except Exception as exc:
                logger.exception("本地 Qdrant 初始化失败")
                missing.append(f"本地 Qdrant ({exc})")

            try:
                await ValueESRepository(es_client_manager.client).ensure_index()
            except Exception as exc:
                logger.exception("本地字段值索引初始化失败")
                missing.append(f"本地字段值索引 ({exc})")

            try:
                await embedding_client_manager.health_check()
            except Exception as exc:
                logger.exception("本地 Embedding 健康检查失败")
                missing.append(f"本地 Embedding ({exc})")
        else:
            if qdrant_client_manager.client is None:
                missing.append("Qdrant")
            else:
                try:
                    await qdrant_client_manager.client.get_collections()
                    if not await qdrant_client_manager.client.collection_exists(
                        ColumnQdrantRepository.collection_name
                    ):
                        missing.append("Qdrant 字段 collection")
                    if not await qdrant_client_manager.client.collection_exists(
                        MetricQdrantRepository.collection_name
                    ):
                        missing.append("Qdrant 指标 collection")
                except Exception:
                    missing.append("Qdrant")
            if es_client_manager.client is None:
                missing.append("Elasticsearch")
            else:
                try:
                    if not await es_client_manager.client.ping():
                        missing.append("Elasticsearch")
                    elif not await es_client_manager.client.indices.exists(
                        index=ValueESRepository.index_name
                    ):
                        missing.append("Elasticsearch value_index")
                except Exception:
                    missing.append("Elasticsearch")
            if embedding_client_manager.client is None:
                missing.append("Embedding")
        if not app_config.llm.api_key:
            missing.append("LLM_API_KEY")
        if not app_config.llm.base_url:
            missing.append("LLM_BASE_URL")
        if not app_config.llm.model_name:
            missing.append("LLM_MODEL_NAME")
        if missing:
            raise RuntimeError("完整模式依赖检查失败：" + "、".join(missing))

    # yield 之前是启动逻辑，yield 之后是关闭逻辑；中间阶段由 FastAPI 正常处理请求
    yield

    # 关闭阶段：按应用级资源统一释放连接，避免进程退出前留下未关闭的网络连接
    await qdrant_client_manager.close()
    await es_client_manager.close()
    await meta_mysql_client_manager.close()
    await dw_mysql_client_manager.close()
