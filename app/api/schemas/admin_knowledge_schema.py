"""后台元数据编辑契约；标识符与现有 MySQL 元数据主键长度一致。"""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Identifier = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$", max_length=64)
]
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]


class Column(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Identifier
    role: Literal["primary_key", "foreign_key", "measure", "dimension"]
    description: str = Field(default="", max_length=10000)
    alias: list[Label] = Field(default_factory=list, max_length=100)
    sync: bool = False


class Table(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Identifier
    role: Literal["fact", "dim"]
    description: str = Field(default="", max_length=10000)
    columns: list[Column] = Field(default_factory=list, max_length=1000)


class Metric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=10000)
    relevant_columns: list[str] = Field(default_factory=list, max_length=1000)
    alias: list[Label] = Field(default_factory=list, max_length=100)


class MetadataUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: str = Field(min_length=1, max_length=128)
    tables: list[Table] = Field(default_factory=list, max_length=500)
    metrics: list[Metric] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def validate_relationships(self) -> Self:
        table_names: set[str] = set()
        column_ids: set[str] = set()
        for table in self.tables:
            if table.name.casefold() in table_names:
                raise ValueError(f"表名重复：{table.name}")
            table_names.add(table.name.casefold())
            names: set[str] = set()
            for column in table.columns:
                if column.name.casefold() in names:
                    raise ValueError(f"字段名重复：{table.name}.{column.name}")
                names.add(column.name.casefold())
                column_id = f"{table.name}.{column.name}"
                if len(column_id) > 64:
                    raise ValueError("表名与字段名组合不能超过 64 个字符")
                column_ids.add(column_id)
        metric_names: set[str] = set()
        for metric in self.metrics:
            if not metric.name.strip():
                raise ValueError("指标名称不能为空")
            if metric.name.casefold() in metric_names:
                raise ValueError(f"指标名重复：{metric.name}")
            metric_names.add(metric.name.casefold())
            if len(set(metric.relevant_columns)) != len(metric.relevant_columns):
                raise ValueError(f"指标 {metric.name} 包含重复字段引用")
            missing = set(metric.relevant_columns) - column_ids
            if missing:
                raise ValueError(
                    f"指标 {metric.name} 引用了不存在的字段：{', '.join(sorted(missing))}"
                )
        return self
