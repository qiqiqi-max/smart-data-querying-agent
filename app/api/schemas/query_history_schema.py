"""
问数历史接口 Schema

定义前端最近分析列表需要消费的数据结构。
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class QueryHistorySummaryItem(BaseModel):
    """最近问数记录响应项"""

    id: str
    query: str
    status: str
    summary: str | None
    row_count: int
    error: str | None
    created_at: datetime
    updated_at: datetime


class QueryHistoryItem(QueryHistorySummaryItem):
    """打开历史时返回完整结果与 SQL。"""

    result: Any
    sql: str | None = None
    response: dict | None = None
