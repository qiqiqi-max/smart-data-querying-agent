"""
问数历史实体

作为 Repository 和 API Schema 之间的应用层数据对象。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class QueryHistorySummary:
    """历史列表摘要，不包含完整结果和 SQL。"""

    id: str
    query: str
    status: str
    summary: str | None
    row_count: int
    error: str | None
    created_at: datetime
    updated_at: datetime


@dataclass
class QueryHistory(QueryHistorySummary):
    """单次问数详情。"""

    result: Any
    sql: str | None = None
    response: dict | None = None
