import asyncio

import pytest
from sqlalchemy import create_engine, inspect, text

from app.models.query_history import QueryHistoryMySQL
from app.repositories.mysql.meta.query_history_repository import (
    QueryHistoryRepository,
    ensure_query_history_columns,
)

# 新增 sql 列之前的旧表结构
LEGACY_DDL = """
CREATE TABLE query_history (
    id VARCHAR(36) PRIMARY KEY,
    query TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    summary TEXT,
    result JSON,
    row_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""


def _columns(engine):
    return {column["name"] for column in inspect(engine).get_columns("query_history")}


def test_migration_adds_missing_nullable_columns_once():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text(LEGACY_DDL))
        connection.execute(
            text(
                "INSERT INTO query_history (id, query, status) VALUES ('h1', 'q', 'done')"
            )
        )

    with engine.begin() as connection:
        assert ensure_query_history_columns(connection) == ["sql", "response"]
    with engine.begin() as connection:
        # 再次启动时不重复加列
        assert ensure_query_history_columns(connection) == []

    assert "sql" in _columns(engine)
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT query, sql, response FROM query_history")
        ).one()
    assert tuple(row) == ("q", None, None)


def test_migration_is_noop_for_tables_created_from_the_model():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        QueryHistoryMySQL.__table__.create(connection)
        assert ensure_query_history_columns(connection) == []


def test_migration_refuses_to_add_non_nullable_columns(monkeypatch):
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text(LEGACY_DDL))
    monkeypatch.setattr(QueryHistoryMySQL.__table__.columns["sql"], "nullable", False)

    with engine.begin() as connection, pytest.raises(RuntimeError, match="sql"):
        ensure_query_history_columns(connection)


class _FakeSession:
    def __init__(self, model):
        self.model = model

    async def get(self, _model_class, _history_id):
        return self.model

    async def commit(self):
        pass


def test_mark_done_and_mark_error_store_sql():
    model = QueryHistoryMySQL(id="h1", query="q", status="running")
    repository = QueryHistoryRepository(_FakeSession(model))

    asyncio.run(repository.mark_done("h1", [{"a": 1}], "ok", sql="SELECT 1"))
    assert model.sql == "SELECT 1"

    # 失败事件没有带 SQL 时保留已有值，带了就覆盖
    asyncio.run(repository.mark_error("h1", "boom"))
    assert model.sql == "SELECT 1"
    asyncio.run(repository.mark_error("h1", "boom", sql="SELECT broken"))
    assert model.sql == "SELECT broken"


def test_business_reply_is_saved_without_fake_result_or_error():
    model = QueryHistoryMySQL(
        id="h1", query="最近销售怎么样", status="running", row_count=0
    )
    repository = QueryHistoryRepository(_FakeSession(model))
    reply = {
        "status": "clarify",
        "message": "请补充时间和指标。",
        "questions": ["查看哪个时间范围？"],
        "missing_information": [],
    }
    asyncio.run(repository.mark_response("h1", reply))
    assert model.status == "clarify"
    assert model.response == reply
    assert model.summary == reply["message"]
    assert model.result is None and model.sql is None and model.error is None
    assert model.row_count == 0
