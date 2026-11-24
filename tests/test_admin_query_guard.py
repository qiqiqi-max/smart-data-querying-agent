import asyncio

import pytest
from fastapi import HTTPException

from app.api.schemas.query_schema import QuerySchema
from app.core.maintenance import MaintenanceState


def test_query_is_reserved_before_response_starts_and_released_after(monkeypatch):
    from app.api.routers import query_router as module

    gate = MaintenanceState()
    monkeypatch.setattr(module, "maintenance", gate)

    class Service:
        async def query(self, query):
            yield 'data: {"type":"result","data":[]}\n\n'

    async def exercise():
        response = await module.query_handler(QuerySchema(query="test"), Service())
        assert gate.snapshot()["active_queries"] == 1
        with pytest.raises(HTTPException):
            gate.start_build()
        sent = []

        async def send(message):
            sent.append(message)

        async def receive():
            return {"type": "http.disconnect"}

        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
        assert sent[0]["status"] == 200
        assert gate.snapshot()["active_queries"] == 0
        gate.start_build()
        with pytest.raises(HTTPException) as error:
            await module.query_handler(QuerySchema(query="test"), Service())
        assert error.value.status_code == 409

    asyncio.run(exercise())
