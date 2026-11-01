"""
问数历史接口 Schema

定义前端最近分析列表需要消费的数据结构。
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class QueryHistoryItem(BaseModel):
    """最近问数记录响应项"""

    id: str
    query: str
    status: str
    summary: str | None
    result: Any
    row_count: int
    error: str | None
    created_at: datetime
    updated_at: datetime
    sql: str | None = None
