import asyncio
from datetime import datetime, timedelta

import pytest

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


@pytest.mark.parametrize("identifier", ["fact_order; DROP TABLE users", "fact-order", "1table"])
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
    assert route_after_validation({"error": "bad sql", "sql_retry_count": 0}) == "correct_sql"
    assert route_after_validation({"error": "bad sql", "sql_retry_count": 1}) == "correct_sql"
    assert route_after_validation({"error": "bad sql", "sql_retry_count": 2}) == "fail_sql"


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
    [("done", 1), ("error", 1), ("running", RUNNING_STALE_MINUTES + 1)],
)
def test_delete_allows_finished_or_stale_history(status, minutes_ago):
    model = _history(status, minutes_ago)
    session = _FakeSession(model)
    assert asyncio.run(QueryHistoryRepository(session).delete("h1")) is True
    assert session.deleted is model


def test_delete_returns_false_for_missing_history():
    assert asyncio.run(QueryHistoryRepository(_FakeSession(None)).delete("h1")) is False


def test_keyword_dedupe_preserves_first_seen_order():
    assert dedupe_preserve_order(["销售额", "华北", "销售额", "GMV", "华北"]) == [
        "销售额",
        "华北",
        "GMV",
    ]
