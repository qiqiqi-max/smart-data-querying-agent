import asyncio
from datetime import datetime, timedelta

import pytest

from app.agent import query_assessment as assessment_module
from app.agent.graph import route_after_validation
from app.agent.keyword_utils import dedupe_preserve_order
from app.agent.sql_utils import clean_llm_sql
from app.models.query_history import QueryHistoryMySQL
from app.repositories.mysql.dw.dw_mysql_repository import DWMySQLRepository
from app.repositories.mysql.meta.query_history_repository import (
    RUNNING_STALE_MINUTES,
    QueryHistoryRepository,
    QueryHistoryRunningError,
)

CONTEXT_TABLES = [
    {
        "name": "fact_order",
        "columns": [
            {"name": "order_id", "type": "int"},
            {"name": "order_amount", "type": "decimal"},
        ],
    }
]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT customer_score FROM fact_order",
        "SELECT * FROM secret_table",
        "SELECT order_amount FROM other_db.fact_order",
    ],
)
def test_query_context_rejects_unknown_column_table_and_database(sql):
    with pytest.raises(ValueError):
        assessment_module.check_sql_context(sql, CONTEXT_TABLES)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT SUM(f.order_amount) AS total FROM fact_order f ORDER BY total",
        "WITH x AS (SELECT order_amount FROM fact_order) SELECT SUM(order_amount) AS total FROM x",
        "SELECT order_amount FROM fact_order UNION ALL SELECT order_amount FROM fact_order",
    ],
)
def test_query_context_supports_aliases_ctes_and_union(sql):
    assessment_module.check_sql_context(
        sql, CONTEXT_TABLES, required_columns=["fact_order.order_amount"]
    )


def test_query_context_rejects_sql_that_drops_required_information():
    with pytest.raises(ValueError):
        assessment_module.check_sql_context(
            "SELECT order_id FROM fact_order",
            CONTEXT_TABLES,
            required_columns=["fact_order.order_amount"],
        )


def test_query_context_accepts_the_configured_database_qualifier():
    assessment_module.check_sql_context(
        "SELECT order_amount FROM dw.fact_order",
        CONTEXT_TABLES,
        required_columns=["fact_order.order_amount"],
        database="dw",
    )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1",
        "WITH data AS (SELECT 1) SELECT * FROM data",
        "SELECT 1 UNION SELECT 2",
        "SELECT 1 UNION ALL SELECT 2 ORDER BY 1",
        "(SELECT 1)",
    ],
)
def test_read_only_sql_accepts_select_statements(sql):
    result = DWMySQLRepository._ensure_read_only(sql)
    assert result.upper().startswith(("SELECT", "WITH", "("))


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM fact_order",
        "SELECT 1; SELECT 2",
        "DROP TABLE fact_order",
        "SELECT 1 FOR UPDATE",
        "SELECT * FROM (SELECT 1 FOR UPDATE) t",
        "SELECT 1 UNION SELECT 2 FOR UPDATE",
        "INSERT INTO fact_order SELECT * FROM fact_order",
    ],
)
def test_read_only_sql_rejects_writes_and_multiple_statements(sql):
    with pytest.raises(ValueError):
        DWMySQLRepository._ensure_read_only(sql)


@pytest.mark.parametrize(
    "identifier", ["fact_order; DROP TABLE users", "fact-order", "1table"]
)
def test_identifier_validation_rejects_injection_shapes(identifier):
    with pytest.raises(ValueError):
        DWMySQLRepository._quote_identifier(identifier)


def test_identifier_validation_quotes_valid_identifier():
    assert DWMySQLRepository._quote_identifier("fact_order") == "`fact_order`"


def test_limit_validation_rejects_out_of_range_values():
    with pytest.raises(ValueError):
        DWMySQLRepository._validate_limit(0)
    with pytest.raises(ValueError):
        DWMySQLRepository._validate_limit(100001)


def test_validation_route_has_a_bounded_correction_loop():
    assert route_after_validation({"error": None}) == "run_sql"
    assert (
        route_after_validation({"error": "bad sql", "sql_retry_count": 0})
        == "correct_sql"
    )
    assert (
        route_after_validation({"error": "bad sql", "sql_retry_count": 1})
        == "correct_sql"
    )
    assert (
        route_after_validation({"error": "bad sql", "sql_retry_count": 2}) == "fail_sql"
    )


def _limited_sql(sql: str, max_rows: int = 100) -> str:
    statement = DWMySQLRepository._parse_read_only(sql)
    return DWMySQLRepository._apply_row_limit(statement, max_rows).sql(dialect="mysql")


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ("SELECT a FROM t", "SELECT a FROM t LIMIT 100"),
        ("SELECT a FROM t LIMIT 5", "SELECT a FROM t LIMIT 5"),
        ("SELECT a FROM t LIMIT 5000", "SELECT a FROM t LIMIT 100"),
        ("SELECT a FROM t LIMIT 2, 5000", "SELECT a FROM t LIMIT 100 OFFSET 2"),
        ("SELECT 1 UNION SELECT 2", "SELECT 1 UNION SELECT 2 LIMIT 100"),
    ],
)
def test_row_limit_caps_outer_limit(sql, expected):
    assert _limited_sql(sql) == expected


class _FakeDWSession:
    """记录执行的 SQL，并按 SQL 中的 LIMIT 返回不超过 available 行的数据。"""

    def __init__(self, available: int):
        self.available = available
        self.sqls = []

    async def execute(self, clause):
        sql = str(clause)
        self.sqls.append(sql)
        limit = DWMySQLRepository._parse_read_only(sql).args["limit"].expression
        rows = [{"n": i} for i in range(min(self.available, int(limit.this)))]

        class _Result:
            def mappings(self):
                return self

            def fetchall(self):
                return rows

        return _Result()


@pytest.mark.parametrize(
    ("sql", "available", "expected_rows", "expected_truncated", "expected_limit"),
    [
        # 无 LIMIT 时多取一行，结果恰好等于上限不算截断
        ("SELECT n FROM t", 3, 3, False, "LIMIT 4"),
        ("SELECT n FROM t", 4, 3, True, "LIMIT 4"),
        # 用户 LIMIT 不超过上限时保持原样，即使数据更多也不算截断
        ("SELECT n FROM t LIMIT 3", 10, 3, False, "LIMIT 3"),
        ("SELECT n FROM t LIMIT 2", 10, 2, False, "LIMIT 2"),
        # 用户 LIMIT 恰好是上限加一时同样只返回上限行数，并标记截断
        ("SELECT n FROM t LIMIT 4", 10, 3, True, "LIMIT 4"),
        # 用户 LIMIT 超过上限时收紧，并保留原 OFFSET
        ("SELECT n FROM t LIMIT 5, 100", 10, 3, True, "LIMIT 4 OFFSET 5"),
        ("SELECT n FROM t LIMIT 100", 3, 3, False, "LIMIT 4"),
    ],
)
def test_run_reports_truncation_only_when_extra_row_exists(
    monkeypatch, sql, available, expected_rows, expected_truncated, expected_limit
):
    monkeypatch.setattr(DWMySQLRepository, "MAX_RESULT_ROWS", 3)
    session = _FakeDWSession(available)

    rows, truncated = asyncio.run(DWMySQLRepository(session).run(sql))

    assert len(rows) == expected_rows
    assert truncated is expected_truncated
    assert session.sqls[0].endswith(expected_limit)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT a FROM t",
        "SELECT /*+ MAX_EXECUTION_TIME(999999) */ a FROM t",
        "SELECT 1 UNION SELECT 2",
        "WITH x AS (SELECT 1 AS v) SELECT v FROM x",
        "(SELECT 1)",
    ],
)
def test_execution_timeout_hint_is_applied_once(sql):
    statement = DWMySQLRepository._parse_read_only(sql)
    result = DWMySQLRepository._apply_execution_timeout(statement, 30000).sql(
        dialect="mysql"
    )
    assert result.count("MAX_EXECUTION_TIME") == 1
    assert "MAX_EXECUTION_TIME(30000)" in result


@pytest.mark.parametrize(
    "text",
    [
        "SELECT 1",
        "  SELECT 1\n",
        "```sql\nSELECT 1\n```",
        "```SQL\nSELECT 1\n```",
        "```\nSELECT 1\n```",
    ],
)
def test_clean_llm_sql_strips_code_fences(text):
    assert clean_llm_sql(text) == "SELECT 1"


def test_clean_llm_sql_keeps_multiline_body():
    assert clean_llm_sql("```sql\nSELECT a\nFROM t\n```") == "SELECT a\nFROM t"


class _FakeSession:
    def __init__(self, model):
        self.model = model
        self.deleted = None

    async def get(self, _model_class, _history_id):
        return self.model

    async def delete(self, model):
        self.deleted = model

    async def commit(self):
        pass


def _history(status: str, minutes_ago: int) -> QueryHistoryMySQL:
    return QueryHistoryMySQL(
        id="h1",
        query="q",
        status=status,
        updated_at=datetime.now() - timedelta(minutes=minutes_ago),
    )


def test_delete_rejects_active_running_history():
    session = _FakeSession(_history("running", minutes_ago=1))
    with pytest.raises(QueryHistoryRunningError):
        asyncio.run(QueryHistoryRepository(session).delete("h1"))
    assert session.deleted is None


@pytest.mark.parametrize(
    ("status", "minutes_ago"),
    [
        ("done", 1),
        ("error", 1),
        ("stopped", 1),
        ("running", RUNNING_STALE_MINUTES + 1),
    ],
)
def test_delete_allows_finished_or_stale_history(status, minutes_ago):
    model = _history(status, minutes_ago)
    session = _FakeSession(model)
    assert asyncio.run(QueryHistoryRepository(session).delete("h1")) is True
    assert session.deleted is model


def test_delete_returns_false_for_missing_history():
    assert asyncio.run(QueryHistoryRepository(_FakeSession(None)).delete("h1")) is False


class _RecordingSession:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)

        class _Result:
            rowcount = 1

        return _Result()

    async def commit(self):
        pass


def test_mark_interrupted_sets_stopped_without_error():
    session = _RecordingSession()

    assert asyncio.run(QueryHistoryRepository(session).mark_interrupted("h1")) is True

    params = session.statements[0].compile().params
    assert params["status"] == "stopped"
    assert params["summary"] == "已停止本次查询。"
    assert params["error"] is None
    # 只更新仍在运行的目标记录，已结束的记录不会被覆盖
    assert params["id_1"] == "h1"
    assert params["status_1"] == "running"


def test_mark_stale_running_keeps_error_status():
    session = _RecordingSession()

    asyncio.run(QueryHistoryRepository(session).mark_stale_running())

    params = session.statements[0].compile().params
    assert params["status"] == "error"
    assert params["status_1"] == "running"


def test_keyword_dedupe_preserves_first_seen_order():
    assert dedupe_preserve_order(["销售额", "华北", "销售额", "GMV", "华北"]) == [
        "销售额",
        "华北",
        "GMV",
    ]
