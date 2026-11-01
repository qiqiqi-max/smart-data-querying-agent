"""
`query_history` ORM 模型

保存每次自然语言问数的运行记录，供前端展示最近分析和排查失败原因。
"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.models.base import Base


class QueryHistoryMySQL(Base):
    """问数历史表对应的 ORM 模型"""

    __tablename__ = "query_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, comment="记录编号")
    query: Mapped[str] = mapped_column(Text, nullable=False, comment="用户问题")
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, comment="运行状态(running/done/error/stopped)"
    )
    summary: Mapped[str | None] = mapped_column(Text, comment="结果摘要")
    result: Mapped[dict | list | None] = mapped_column(JSON, comment="结构化查询结果")
    row_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, comment="结果行数"
    )
    error: Mapped[str | None] = mapped_column(Text, comment="错误信息")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        index=True,
        nullable=False,
        comment="更新时间",
    )
