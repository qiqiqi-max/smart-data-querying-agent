"""Real local administration APIs for configuration, knowledge and history."""

import asyncio
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import AdminRoute, require_local_admin
from app.api.dependencies import get_meta_session, get_query_history_repository
from app.api.schemas.admin_knowledge_schema import MetadataUpdate
from app.api.schemas.admin_settings_schema import (
    DatabaseSettingsInput,
    ModelSettingsInput,
    SettingsUpdate,
)
from app.api.schemas.query_history_schema import QueryHistoryItem
from app.clients.embedding_client_manager import embedding_client_manager
from app.clients.es_client_manager import es_client_manager
from app.clients.mysql_client_manager import (
    dw_mysql_client_manager,
    meta_mysql_client_manager,
)
from app.clients.qdrant_client_manager import qdrant_client_manager
from app.conf.app_config import app_config
from app.core.maintenance import maintenance
from app.models.query_history import QueryHistoryMySQL
from app.repositories.mysql.meta.query_history_repository import (
    QueryHistoryRepository,
    QueryHistoryRunningError,
)
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository
from app.repositories.qdrant.metric_qdrant_repository import MetricQdrantRepository
from app.services.admin_queries import list_queries
from app.services.admin_runtime import audit, knowledge_service, settings_service

admin_router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    route_class=AdminRoute,
    dependencies=[Depends(require_local_admin)],
)


@admin_router.get("/settings")
async def settings():
    return await asyncio.to_thread(settings_service.read)


@admin_router.put("/settings")
async def save_settings(payload: SettingsUpdate):
    result = await asyncio.to_thread(settings_service.save, payload)
    await asyncio.to_thread(
        audit.record, "settings.save", "done", "连接与模型配置已保存，重启后应用。"
    )
    return result


@admin_router.post("/test-database/{name}")
async def test_database(name: Literal["meta", "dw"], payload: DatabaseSettingsInput):
    result = await settings_service.test_database(name, payload)
    audit.record(
        "database.test",
        "done" if result["ok"] else "error",
        f"{name}：{result['message']}",
    )
    return result


@admin_router.post("/test-model")
async def test_model(payload: ModelSettingsInput):
    result = await settings_service.test_model(payload)
    audit.record("model.test", "done" if result["ok"] else "error", result["message"])
    return result


@admin_router.get("/schema")
async def schema():
    def read(connection):
        inspector = inspect(connection)
        tables = []
        for name in sorted(inspector.get_table_names()):
            keys = set(
                inspector.get_pk_constraint(name).get("constrained_columns") or []
            )
            tables.append(
                {
                    "name": name,
                    "columns": [
                        {
                            "name": column["name"],
                            "type": str(column["type"]),
                            "nullable": column["nullable"],
                            "primary_key": column["name"] in keys,
                            "comment": column.get("comment") or "",
                        }
                        for column in inspector.get_columns(name)
                    ],
                }
            )
        return {"tables": tables}

    try:
        async with asyncio.timeout(15):
            async with dw_mysql_client_manager.engine.connect() as connection:
                return await connection.run_sync(read)
    except Exception:
        raise HTTPException(
            503, "读取数仓结构失败，请检查当前生效的数据源连接。"
        ) from None


@admin_router.get("/metadata")
async def metadata():
    return await asyncio.to_thread(knowledge_service.read_metadata)


@admin_router.put("/metadata")
async def save_metadata(payload: MetadataUpdate):
    result = await asyncio.to_thread(knowledge_service.save_metadata, payload)
    audit.record(
        "metadata.save",
        "done",
        f"保存 {len(result['tables'])} 张表、{len(result['metrics'])} 个指标。",
    )
    return result


@admin_router.get("/builds")
async def builds():
    return await asyncio.to_thread(knowledge_service.list_builds)


@admin_router.post("/builds", status_code=202)
async def start_build():
    result = await knowledge_service.start_build()
    audit.record("knowledge.build", "running", "已启动知识库重建，进度见构建记录。")
    return result


@admin_router.get("/queries")
async def queries(
    session: Annotated[AsyncSession, Depends(get_meta_session)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str, Query(max_length=200)] = "",
    status: Literal[
        "", "running", "done", "error", "stopped", "clarify", "unsupported"
    ] = "",
):
    return await list_queries(session, page, page_size, q, status)


@admin_router.get("/queries/{history_id}", response_model=QueryHistoryItem)
async def query_detail(
    history_id: str,
    repository: Annotated[
        QueryHistoryRepository, Depends(get_query_history_repository)
    ],
):
    detail = await repository.get_by_id(history_id)
    if detail is None:
        raise HTTPException(404, "查询记录不存在。")
    return QueryHistoryItem.model_validate(detail, from_attributes=True)


@admin_router.delete("/queries/{history_id}", status_code=204)
async def delete_query(
    history_id: str,
    repository: Annotated[
        QueryHistoryRepository, Depends(get_query_history_repository)
    ],
):
    try:
        deleted = await repository.delete(history_id)
    except QueryHistoryRunningError:
        raise HTTPException(409, "查询仍在运行，不能删除。") from None
    if not deleted:
        raise HTTPException(404, "查询记录不存在。")
    audit.record("query.delete", "done", "删除一条已结束的查询记录。")


@admin_router.get("/audit")
async def audit_items(limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return await asyncio.to_thread(audit.read, limit)


@admin_router.get("/overview")
async def overview():
    metadata = await asyncio.to_thread(knowledge_service.read_metadata)
    settings = await asyncio.to_thread(settings_service.read)
    services = []
    query_status = {}
    total = 0

    async def database_probe(name, manager):
        try:
            async with asyncio.timeout(5):
                async with manager.engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
            return {"name": name, "status": "ready", "message": "连接正常"}
        except Exception:
            return {
                "name": name,
                "status": "error",
                "message": "连接不可用，请检查生效配置",
            }

    services.extend(
        await asyncio.gather(
            database_probe("元数据库 MySQL", meta_mysql_client_manager),
            database_probe("业务数仓 MySQL", dw_mysql_client_manager),
        )
    )
    try:
        async with asyncio.timeout(5):
            async with meta_mysql_client_manager.session_factory() as session:
                rows = (
                    await session.execute(
                        select(QueryHistoryMySQL.status, func.count()).group_by(
                            QueryHistoryMySQL.status
                        )
                    )
                ).all()
                query_status = dict(rows)
                total = sum(query_status.values())
    except Exception:
        services.append(
            {"name": "查询历史", "status": "error", "message": "无法读取查询统计"}
        )
    try:
        async with asyncio.timeout(5):
            client = qdrant_client_manager.client
            column_info = await client.get_collection(
                ColumnQdrantRepository.collection_name
            )
            metric_info = await client.get_collection(
                MetricQdrantRepository.collection_name
            )
        services.append(
            {
                "name": "Qdrant",
                "status": "ready",
                "message": f"字段 {column_info.points_count} 个向量 · 指标 {metric_info.points_count} 个向量",
            }
        )
    except Exception:
        services.append(
            {"name": "Qdrant", "status": "error", "message": "索引不可用或正在重建"}
        )
    embedding = embedding_client_manager.client
    services.append(
        {
            "name": "Embedding",
            "status": "ready" if embedding else "unconfigured",
            "message": "客户端已初始化" if embedding else "尚未初始化",
        }
    )
    if not app_config.local_mode:
        try:
            async with asyncio.timeout(5):
                healthy = await es_client_manager.client.ping()
        except Exception:
            healthy = False
        services.append(
            {
                "name": "Elasticsearch",
                "status": "ready" if healthy else "error",
                "message": "连接正常" if healthy else "连接失败",
            }
        )
    configured = bool(app_config.llm.api_key and app_config.llm.base_url)
    services.append(
        {
            "name": "大模型",
            "status": "ready" if configured else "unconfigured",
            "message": "已配置；实际可用性请执行模型测试"
            if configured
            else "未配置完整",
        }
    )
    return {
        "mode": "local",
        "demo_mode": app_config.demo_mode,
        "maintenance": maintenance.snapshot(),
        "counts": {
            "tables": len(metadata["tables"]),
            "columns": sum(len(table["columns"]) for table in metadata["tables"]),
            "metrics": len(metadata["metrics"]),
            "queries": total,
        },
        "query_status": query_status,
        "services": services,
        "knowledge": {
            key: metadata[key] for key in ("revision", "built_revision", "dirty")
        },
        "restart_required": settings["restart_required"],
    }
