"""
问数接口请求体定义

集中声明 API 层输入输出的数据结构，让路由函数只处理业务流程，
字段校验和 OpenAPI 文档生成交给 Pydantic 与 FastAPI 完成。
"""

from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class QuerySchema(BaseModel):
    """`/api/query` 请求体，承载用户输入的自然语言问题"""

    # 前端请求体中的 query 字段，例如 {"query": "统计华北地区销售额"}
    query: str = Field(min_length=1, max_length=500)
    parent_history_id: str | None = None

    @field_validator("parent_history_id")
    @classmethod
    def validate_parent(cls, value: str | None) -> str | None:
        return str(UUID(value)) if value is not None else None

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        """清理用户输入，避免空白字符串进入问数链路"""

        query = value.strip()
        if not query:
            raise ValueError("query 不能为空")
        return query
