"""
问数历史实体

作为 Repository 和 API Schema 之间的应用层数据对象。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class QueryHistory:
    """一次问数运行记录"""

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
