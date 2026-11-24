import asyncio
from datetime import datetime, timedelta

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.models.query_history import QueryHistoryMySQL


class AsyncAdapter:
    def __init__(self, session):
        self.session = session

    async def execute(self, statement):
        return self.session.execute(statement)


def test_admin_queries_filter_paginate_and_omit_results():
    from app.services.admin_queries import list_queries

    engine = create_engine("sqlite://")
    QueryHistoryMySQL.__table__.create(engine)
    now = datetime(2026, 11, 5)
    with Session(engine) as session:
        for i in range(5):
            session.add(
                QueryHistoryMySQL(
                    id=str(i),
                    query=f"sales {i}",
                    status="error" if i == 3 else "done",
                    row_count=i,
                    result=[{"private_payload": i}],
                    sql="SELECT 1",
                    created_at=now,
                    updated_at=now + timedelta(seconds=i),
                )
            )
        session.commit()
    statements = []
    event.listen(
        engine,
        "before_cursor_execute",
        lambda conn, cursor, sql, params, context, many: statements.append(sql),
    )
    with Session(engine) as session:

        async def exercise():
            result = await list_queries(
                AsyncAdapter(session), page=2, page_size=2, q="sales", status="done"
            )
            assert result["total"] == 4
            assert [item["id"] for item in result["items"]] == ["1", "0"]
            assert all(
                "result" not in item and "sql" not in item for item in result["items"]
            )
            exact = await list_queries(
                AsyncAdapter(session), q="sales 3", status="error"
            )
            assert exact["total"] == 1

        asyncio.run(exercise())
    assert all(
        "query_history.result" not in sql and "query_history.sql" not in sql
        for sql in statements
    )
    engine.dispose()
