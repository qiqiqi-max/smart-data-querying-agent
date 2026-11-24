"""
数仓 MySQL 仓储

这一层对应文档里的 DW Repository，职责是到真实数仓中补齐配置文件里
没有显式维护的信息，例如字段类型和字段示例值。Service 层只关心
“需要哪些信息”，具体怎样查数仓由仓储层统一封装
SQL 生成闭环中的数据库环境读取 SQL 校验和最终查询执行也集中放在这里
"""

import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlglot import exp, parse
from sqlglot.errors import ParseError


class DWMySQLRepository:
    """负责查询数仓真实表结构和字段样例值"""

    # 最终查询的服务端执行时间上限，超时由 MySQL 中断并返回 3024 错误
    MAX_EXECUTION_TIME_MS = 30_000
    # 最终查询最多返回的行数，避免大结果集全部读入内存并写入历史记录
    MAX_RESULT_ROWS = 1000

    async def get_schema_columns(self) -> dict[str, dict[str, str]]:
        """Inspect only the currently connected business database."""
        result = await self.session.execute(
            text(
                "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type "
                "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                "ORDER BY TABLE_NAME, ORDINAL_POSITION"
            )
        )
        schema: dict[str, dict[str, str]] = {}
        for row in result.mappings().all():
            schema.setdefault(row["table_name"], {})[row["column_name"]] = row[
                "data_type"
            ]
        return schema

    def __init__(self, session: AsyncSession):
        self.session = session

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        """校验并引用 MySQL 标识符，避免动态表名和字段名注入。"""
        if not isinstance(identifier, str) or not re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*", identifier
        ):
            raise ValueError(f"非法数据库标识符：{identifier}")
        return f"`{identifier}`"

    @staticmethod
    def _validate_limit(limit: int) -> int:
        """限制元数据抽样规模，避免异常参数造成无界查询。"""
        if not isinstance(limit, int) or not 1 <= limit <= 100_000:
            raise ValueError("limit 必须是 1 到 100000 之间的整数")
        return limit

    @staticmethod
    def _parse_read_only(sql: str) -> exp.Query:
        """解析 SQL，只允许单条只读查询，包括 UNION 等集合查询。"""
        normalized = sql.strip()
        if not normalized:
            raise ValueError("只允许执行单条只读 SELECT 查询")
        try:
            statements = parse(normalized, read="mysql")
        except ParseError as exc:
            raise ValueError("SQL 解析失败") from exc
        statement = statements[0] if len(statements) == 1 else None
        # exp.Query 覆盖 SELECT、UNION/INTERSECT/EXCEPT 和带括号的查询
        if not isinstance(statement, exp.Query):
            raise ValueError("只允许执行单条只读 SELECT 查询")
        # 子查询里的锁定子句同样会加锁，需要在整棵语法树中查找
        if statement.find(exp.Lock) or statement.find(exp.Into):
            raise ValueError("不允许使用锁定或导出数据的 SELECT 语法")
        return statement

    @staticmethod
    def _ensure_read_only(sql: str) -> str:
        """只允许单条只读查询，避免模型输出修改数据的语句。"""
        return DWMySQLRepository._parse_read_only(sql).sql(dialect="mysql")

    @staticmethod
    def _apply_row_limit(statement: exp.Query, max_rows: int) -> exp.Query:
        """把最外层 LIMIT 收紧到 max_rows，已有更小的 LIMIT 保持不变。"""
        limit = statement.args.get("limit")
        current = limit.expression if limit is not None else None
        if (
            isinstance(current, exp.Literal)
            and current.is_int
            and int(current.this) <= max_rows
        ):
            return statement
        # MySQL 的 LIMIT offset, count 中 offset 是独立参数，这里不受影响
        statement.set("limit", exp.Limit(expression=exp.Literal.number(max_rows)))
        return statement

    @staticmethod
    def _apply_execution_timeout(statement: exp.Query, timeout_ms: int) -> exp.Query:
        """在首个 SELECT 上加 MAX_EXECUTION_TIME 提示，只作用于本条语句。"""
        select = statement
        # UNION 的提示写在最左侧 SELECT 上，带括号的查询需要先拆开
        while not isinstance(select, exp.Select):
            select = select.this
        select.set(
            "hint",
            exp.Hint(
                expressions=[
                    exp.Anonymous(
                        this="MAX_EXECUTION_TIME",
                        expressions=[exp.Literal.number(timeout_ms)],
                    )
                ]
            ),
        )
        return statement

    async def get_column_types(self, table_name: str) -> dict[str, str]:
        """查询整张表的字段类型，作为 ColumnInfo.type 的真实来源"""
        sql = f"show columns from {self._quote_identifier(table_name)}"
        result = await self.session.execute(text(sql))
        result_dict = result.mappings().fetchall()
        return {row["Field"]: row["Type"] for row in result_dict}

    async def get_column_values(
        self, table_name: str, column_name: str, limit: int = 10
    ) -> list:
        """抽样查询字段示例值，供元数据入库和后续检索链路复用"""
        table = self._quote_identifier(table_name)
        column = self._quote_identifier(column_name)
        safe_limit = self._validate_limit(limit)
        sql = f"select distinct {column} from {table} limit {safe_limit}"
        result = await self.session.execute(text(sql))
        return [row[0] for row in result.fetchall()]

    async def get_db_info(self):
        """读取当前数仓数据库的方言和版本，供 SQL 生成提示词使用"""

        sql = "select version()"
        result = await self.session.execute(text(sql))
        version = result.scalar()

        # dialect 来自 SQLAlchemy 当前绑定的数据库方言，例如 mysql
        dialect = self.session.bind.dialect.name
        return {"dialect": dialect, "version": version}

    async def validate(self, sql: str):
        """用 EXPLAIN 让数据库提前解析 SQL，发现语法 表名 字段名等错误"""
        sql = f"explain {self._ensure_read_only(sql)}"
        await self.session.execute(text(sql))

    async def run(self, sql: str) -> tuple[list[dict], bool]:
        """执行最终 SQL，返回字典列表形式的结果行，以及结果是否被行数上限截断"""
        max_rows = self.MAX_RESULT_ROWS
        statement = self._parse_read_only(sql)
        # 上限多放一行用于判断截断：只有确实取到第 max_rows + 1 行才算被截断，
        # 用户自己的 LIMIT 不超过 max_rows 时保持原样，结果本身不会超过上限
        statement = self._apply_row_limit(statement, max_rows + 1)
        statement = self._apply_execution_timeout(statement, self.MAX_EXECUTION_TIME_MS)
        result = await self.session.execute(text(statement.sql(dialect="mysql")))
        rows = [dict(row) for row in result.mappings().fetchall()]
        return rows[:max_rows], len(rows) > max_rows
