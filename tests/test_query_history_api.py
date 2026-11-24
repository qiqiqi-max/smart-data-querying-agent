import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_query_history_repository
from app.api.routers.query_router import query_router
from app.models.query_history import QueryHistoryMySQL
from app.repositories.mysql.meta.query_history_repository import QueryHistoryRepository


class AsyncSessionAdapter:
    """Run the production repository's real SQL against a local SQLite fixture."""

    def __init__(self, session):
        self.session = session

    async def execute(self, statement):
        return self.session.execute(statement)

    async def get(self, model, key):
        return self.session.get(model, key)

    async def commit(self):
        self.session.commit()

    async def rollback(self):
        self.session.rollback()


@pytest.fixture
def history_store():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    QueryHistoryMySQL.__table__.create(engine)
    now = datetime(2026, 11, 2, 10)
    with Session(engine) as session:
        session.add_all(
            [
                QueryHistoryMySQL(
                    id="old",
                    query="older",
                    status="stopped",
                    summary="stopped",
                    row_count=0,
                    created_at=now,
                    updated_at=now,
                ),
                QueryHistoryMySQL(
                    id="done",
                    query="total sales",
                    status="done",
                    summary="one row",
                    result=[{"total": "12345.67"}],
                    sql="SELECT SUM(amount) AS total FROM orders",
                    row_count=1,
                    created_at=now,
                    updated_at=now + timedelta(minutes=1),
                ),
            ]
        )
        session.commit()
    statements = []
    event.listen(
        engine,
        "before_cursor_execute",
        lambda conn, cursor, statement, params, context, many: statements.append(
            statement
        ),
    )
    yield engine, statements
    engine.dispose()


@pytest.fixture
def history_client(history_store):
    engine, _ = history_store
    app = FastAPI()
    app.include_router(query_router)

    async def repository():
        with Session(engine) as session:
            yield QueryHistoryRepository(AsyncSessionAdapter(session))

    app.dependency_overrides[get_query_history_repository] = repository
    with TestClient(app) as client:
        yield client


def test_history_list_omits_payloads_in_json_and_database_query(
    history_client, history_store
):
    response = history_client.get("/api/query/history?limit=1")
    assert response.status_code == 200
    histories = response.json()
    assert [item["id"] for item in histories] == ["done"]
    assert histories[0]["row_count"] == 1
    assert "result" not in histories[0]
    assert "sql" not in histories[0]
    assert "response" not in histories[0]
    selects = [
        sql.lower()
        for sql in history_store[1]
        if sql.lstrip().upper().startswith("SELECT")
    ]
    assert len(selects) == 1
    assert "query_history.result" not in selects[0]
    assert "query_history.sql" not in selects[0]
    assert "query_history.response" not in selects[0]


def test_history_detail_returns_result_and_sql(history_client):
    response = history_client.get("/api/query/history/done")
    assert response.status_code == 200
    assert response.json()["result"] == [{"total": "12345.67"}]
    assert response.json()["sql"] == "SELECT SUM(amount) AS total FROM orders"
    assert response.json()["status"] == "done"


def test_stopped_history_detail_keeps_status_and_empty_payload(history_client):
    response = history_client.get("/api/query/history/old")
    assert response.status_code == 200
    assert response.json()["status"] == "stopped"
    assert response.json()["result"] is None
    assert response.json()["sql"] is None
    assert response.json()["response"] is None


def test_history_detail_missing_is_404(history_client):
    assert history_client.get("/api/query/history/missing").status_code == 404


@pytest.mark.parametrize("limit", [0, 51])
def test_history_limit_remains_bounded(history_client, limit):
    assert history_client.get(f"/api/query/history?limit={limit}").status_code == 422


def test_detail_remains_available_after_loading_summary_in_same_session(history_store):
    engine, _ = history_store
    with Session(engine) as session:
        repository = QueryHistoryRepository(AsyncSessionAdapter(session))

        async def exercise():
            await repository.list_recent(1)
            detail = await repository.get_by_id("done")
            assert detail.result == [{"total": "12345.67"}]
            assert detail.sql.startswith("SELECT")

        asyncio.run(exercise())


def test_clarification_history_can_be_restored_without_rendering_result(
    history_client, history_store
):
    engine, _ = history_store
    response = {
        "status": "clarify",
        "message": "请提供统计范围。",
        "questions": ["查看哪个时间范围？"],
        "missing_information": [],
        "clarification_context": {"original_query": "最近销售怎么样", "turns": []},
    }
    with Session(engine) as session:
        session.add(
            QueryHistoryMySQL(
                id="clarify", query="最近销售怎么样", status="running", row_count=0
            )
        )
        session.commit()
        asyncio.run(
            QueryHistoryRepository(AsyncSessionAdapter(session)).mark_response(
                "clarify", response
            )
        )
    result = history_client.get("/api/query/history/clarify").json()
    assert result["status"] == "clarify"
    assert result["response"]["questions"] == ["查看哪个时间范围？"]
    assert (
        result["result"] is None and result["sql"] is None and result["error"] is None
    )
