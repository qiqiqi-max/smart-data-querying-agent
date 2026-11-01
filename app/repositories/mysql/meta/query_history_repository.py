"""
问数历史 MySQL 仓储

负责新增、更新和读取 `query_history` 记录。
"""

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.entities.query_history import QueryHistory
from app.models.query_history import QueryHistoryMySQL
from app.services.result_summary import count_result_rows

# running 状态超过该时长仍未更新，视为服务重启或连接中断遗留的记录
RUNNING_STALE_MINUTES = 10


class QueryHistoryRunningError(Exception):
    """查询记录仍在运行，不能删除"""


class QueryHistoryRepository:
    """封装查询历史的持久化操作"""

    def __init__(self, session: AsyncSession):
        self.session = session

    @staticmethod
    def _json_safe(value: Any) -> Any:
        """把数据库结果转换为 JSON 列可保存的基础类型。"""
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, list):
            return [QueryHistoryRepository._json_safe(item) for item in value]
        if isinstance(value, tuple):
            return [QueryHistoryRepository._json_safe(item) for item in value]
        if isinstance(value, dict):
            return {
                str(key): QueryHistoryRepository._json_safe(item)
                for key, item in value.items()
            }
        return value

    async def create(self, history_id: str, query: str) -> QueryHistory:
        """创建一条运行中的问数记录"""

        model = QueryHistoryMySQL(
            id=history_id,
            query=query,
            status="running",
            summary="连接中...",
            row_count=0,
        )
        self.session.add(model)
        await self.session.commit()
        await self.session.refresh(model)
        return self.to_entity(model)

    async def mark_done(self, history_id: str, result: object, summary: str):
        """把问数记录标记为成功，并保存结构化结果"""

        model = await self.session.get(QueryHistoryMySQL, history_id)
        if not model:
            return

        model.status = "done"
        model.summary = summary
        model.result = self._json_safe(result)
        model.row_count = count_result_rows(result)
        model.error = None
        model.updated_at = datetime.now()
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

    async def mark_error(self, history_id: str, message: str):
        """把问数记录标记为失败"""

        model = await self.session.get(QueryHistoryMySQL, history_id)
        if not model:
            return

        model.status = "error"
        model.summary = message
        model.error = message
        model.updated_at = datetime.now()
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

    async def delete(self, history_id: str) -> bool:
        """删除指定的查询历史记录，仍在运行的记录不允许删除。"""
        model = await self.session.get(QueryHistoryMySQL, history_id)
        if not model:
            return False
        # 超过时限仍为 running 的记录视为已中断，允许删除，避免永远删不掉
        stale_before = datetime.now() - timedelta(minutes=RUNNING_STALE_MINUTES)
        if model.status == "running" and model.updated_at >= stale_before:
            raise QueryHistoryRunningError(history_id)
        await self.session.delete(model)
        await self.session.commit()
        return True

    async def mark_stale_running(
        self, max_age_minutes: int = RUNNING_STALE_MINUTES
    ) -> int:
        """将服务重启前遗留的运行记录标记为失败。"""
        result = await self.session.execute(
            update(QueryHistoryMySQL)
            .where(
                QueryHistoryMySQL.status == "running",
                QueryHistoryMySQL.updated_at
                < datetime.now() - timedelta(minutes=max_age_minutes),
            )
            .values(
                status="error",
                summary="查询已中断，请重新发起。",
                error="服务重启或连接中断",
            )
        )
        await self.session.commit()
        return result.rowcount or 0

    async def mark_interrupted(self, history_id: str) -> bool:
        """把客户端中途断开的运行记录标记为已停止，已结束的记录保持不变。"""
        result = await self.session.execute(
            update(QueryHistoryMySQL)
            .where(
                QueryHistoryMySQL.id == history_id,
                QueryHistoryMySQL.status == "running",
            )
            .values(
                # 停止与执行失败区分开，不属于错误，error 字段保持为空
                status="stopped",
                summary="已停止本次查询。",
                error=None,
                updated_at=datetime.now(),
            )
        )
        await self.session.commit()
        return bool(result.rowcount)

    async def list_recent(self, limit: int = 20) -> list[QueryHistory]:
        """按更新时间倒序读取最近问数记录"""

        result = await self.session.execute(
            select(QueryHistoryMySQL)
            .order_by(desc(QueryHistoryMySQL.updated_at))
            .limit(limit)
        )
        return [self.to_entity(model) for model in result.scalars().all()]

    @staticmethod
    def to_entity(model: QueryHistoryMySQL) -> QueryHistory:
        """ORM 模型转应用实体"""

        return QueryHistory(
            id=model.id,
            query=model.query,
            status=model.status,
            summary=model.summary,
            result=model.result,
            row_count=model.row_count,
            error=model.error,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )
