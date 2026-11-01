import asyncio
import json

import anyio

from app.api.routers.query_router import ClosingStreamingResponse
from app.services import query_service as query_service_module
from app.services.query_service import QueryService


class _FakeHistoryRepository:
    def __init__(self):
        self.errors = []

    async def create(self, history_id, query):
        self.history_id = history_id

    async def mark_done(self, history_id, result, summary):
        pass

    async def mark_error(self, history_id, message):
        self.errors.append(message)


class _FakeSession:
    def __init__(self, calls):
        self.calls = calls

    async def execute(self, statement):
        # 写入过程中会让出事件循环，未屏蔽取消时这里会直接抛出 CancelledError
        await anyio.sleep(0.01)
        self.calls.append(statement)

        class _Result:
            rowcount = 1

        return _Result()

    async def commit(self):
        await anyio.sleep(0)


class _FakeSessionFactory:
    def __init__(self):
        self.calls = []

    def __call__(self):
        return self

    async def __aenter__(self):
        return _FakeSession(self.calls)

    async def __aexit__(self, *exc):
        return False


class _SlowGraph:
    async def astream(self, **kwargs):
        yield {"type": "progress", "step": "抽取关键词", "status": "running"}
        await anyio.sleep(10)
        yield {"type": "result", "data": []}


def _build_service(history_repository, session_factory):
    return QueryService(
        meta_mysql_repository=None,
        embedding_client=None,
        dw_mysql_repository=None,
        column_qdrant_repository=None,
        metric_qdrant_repository=None,
        value_es_repository=None,
        query_history_repository=history_repository,
        meta_session_factory=session_factory,
    )


def test_client_disconnect_marks_history_interrupted(monkeypatch):
    monkeypatch.setattr(query_service_module, "graph", _SlowGraph())
    history_repository = _FakeHistoryRepository()
    session_factory = _FakeSessionFactory()
    service = _build_service(history_repository, session_factory)
    chunks = []

    async def exercise():
        first_chunk = anyio.Event()

        async def consume():
            async for chunk in service.query("q"):
                chunks.append(chunk)
                first_chunk.set()

        # 与 Starlette 检测到 http.disconnect 后的处理一致：取消正在推送响应的任务
        async with anyio.create_task_group() as task_group:
            task_group.start_soon(consume)
            await first_chunk.wait()
            task_group.cancel_scope.cancel()

    asyncio.run(exercise())

    assert len(chunks) == 1
    assert len(session_factory.calls) == 1
    assert history_repository.errors == []


def test_streaming_response_closes_generator_on_disconnect():
    events = []

    async def body():
        try:
            yield "data: 1\n\n"
            await anyio.sleep(10)
        except GeneratorExit:
            events.append("closed")
            raise

    async def receive():
        # 等首段数据进入发送流程后再报告断开，与真实连接中断的时序一致
        await anyio.sleep(0.05)
        return {"type": "http.disconnect"}

    async def send(message):
        if message.get("more_body"):
            # 断开时发送方阻塞在 send 上，取消落在这里而不是生成器内部
            await anyio.sleep(10)

    async def exercise():
        response = ClosingStreamingResponse(body(), media_type="text/event-stream")
        await response({"type": "http"}, receive, send)

    asyncio.run(exercise())

    assert events == ["closed"]


def test_query_timeout_reports_readable_message(monkeypatch):
    monkeypatch.setattr(query_service_module, "graph", _SlowGraph())
    monkeypatch.setattr(query_service_module, "QUERY_TIMEOUT_SECONDS", 0.05)
    history_repository = _FakeHistoryRepository()
    session_factory = _FakeSessionFactory()
    service = _build_service(history_repository, session_factory)

    async def exercise():
        return [chunk async for chunk in service.query("q")]

    chunks = asyncio.run(exercise())
    error = json.loads(chunks[-1].removeprefix("data: "))

    assert error["type"] == "error"
    assert "查询超时" in error["message"]
    assert history_repository.errors == [error["message"]]
    assert session_factory.calls == []
