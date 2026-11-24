"""Business replies are terminal and follow-up answers keep trusted history."""

import asyncio
import copy
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_query_service
from app.api.routers.query_router import query_router
from app.services import query_service as service_module
from app.services.query_service import QueryService

PARENT = "11111111-1111-4111-8111-111111111111"
QUESTION = "最近销售怎么样"
REPLY = {
    "type": "assessment",
    "status": "clarify",
    "reason": "ambiguous_query",
    "message": "请补充时间范围和指标。",
    "questions": ["查看哪个时间范围？", "销售额还是销量？"],
    "missing_information": [],
}


class History:
    def __init__(self, parent=None):
        self.records = {PARENT: parent} if parent else {}
        self.errors = []
        self.done = []

    async def create(self, history_id, query):
        self.last_id = history_id
        self.records[history_id] = SimpleNamespace(
            id=history_id, query=query, status="running", response=None
        )

    async def get_by_id(self, history_id):
        return self.records.get(history_id)

    async def mark_response(self, history_id, response):
        model = self.records[history_id]
        model.status = response["status"]
        model.response = copy.deepcopy(response)

    async def mark_error(self, history_id, message, sql=None):
        self.errors.append(message)

    async def mark_done(self, history_id, data, summary, sql=None):
        self.done.append(data)


class Graph:
    def __init__(self, event=None):
        self.inputs = []
        self.event = copy.deepcopy(event or REPLY)

    async def astream(self, **kwargs):
        self.inputs.append(kwargs["input"])
        yield copy.deepcopy(self.event)


def build(history):
    return QueryService(
        meta_mysql_repository=None,
        embedding_client=None,
        dw_mysql_repository=None,
        column_qdrant_repository=None,
        metric_qdrant_repository=None,
        value_es_repository=None,
        query_history_repository=history,
        meta_session_factory=None,
    )


def parent(status="clarify", turns=None):
    return SimpleNamespace(
        id=PARENT,
        status=status,
        query=QUESTION,
        response={
            **REPLY,
            "clarification_context": {
                "original_query": QUESTION,
                "turns": copy.deepcopy(turns or []),
            },
        },
    )


def test_assessment_reply_is_terminal_persisted_and_has_server_history_id(monkeypatch):
    graph, history = Graph(), History()
    monkeypatch.setattr(service_module, "graph", graph)

    async def run():
        return [
            json.loads(chunk.removeprefix("data: "))
            async for chunk in build(history).query(QUESTION)
        ]

    events = asyncio.run(run())
    assert [event["type"] for event in events] == ["assessment"]
    assert events[0]["history_id"] == history.last_id
    record = history.records[history.last_id]
    assert record.status == "clarify"
    assert record.response["questions"] == REPLY["questions"]
    assert record.response["clarification_context"] == {
        "original_query": QUESTION,
        "turns": [],
    }
    assert history.errors == history.done == []


def test_followup_keeps_original_question_and_does_not_mutate_parent():
    saved = parent()
    before = copy.deepcopy(saved.response)
    service = build(History(saved))
    context = asyncio.run(
        service.prepare_clarification(PARENT, "本月销售额，按地区汇总")
    )
    assert context["original_query"] == QUESTION
    assert context["turns"] == [
        {"questions": REPLY["questions"], "answer": "本月销售额，按地区汇总"}
    ]
    assert saved.response == before


@pytest.mark.parametrize(
    ("saved", "code"),
    [(None, 404), (parent("done"), 409), (parent("unsupported"), 409)],
)
def test_absent_or_non_pending_parent_cannot_start_followup(saved, code):
    service = build(History(saved))
    with pytest.raises(ValueError) as error:
        asyncio.run(service.prepare_clarification(PARENT, "本月"))
    assert error.value.status_code == code


def test_clarification_chain_is_bounded():
    turns = [
        {"questions": ["补充哪项？"], "answer": f"第{number}次补充"}
        for number in range(5)
    ]
    with pytest.raises(ValueError) as error:
        asyncio.run(
            build(History(parent(turns=turns))).prepare_clarification(
                PARENT, "第六次补充"
            )
        )
    assert error.value.status_code == 400


def test_corrupt_saved_context_cannot_be_treated_as_user_input():
    saved = parent()
    saved.response["clarification_context"]["turns"] = [{"approved_metric": "guess"}]
    with pytest.raises(ValueError) as error:
        asyncio.run(build(History(saved)).prepare_clarification(PARENT, "本月"))
    assert error.value.status_code == 409


def test_followup_is_passed_to_graph_and_written_to_query_history(monkeypatch):
    graph = Graph(
        {"type": "result", "data": [], "sql": "SELECT order_id FROM fact_order"}
    )
    monkeypatch.setattr(service_module, "graph", graph)
    history = History()
    context = {
        "original_query": QUESTION,
        "turns": [
            {"questions": REPLY["questions"], "answer": "本月销售额，按地区汇总"}
        ],
    }

    async def run():
        return [
            chunk
            async for chunk in build(history).query(
                "本月销售额，按地区汇总", clarification_context=context
            )
        ]

    asyncio.run(run())
    assert graph.inputs[0]["clarification_context"] == context
    saved_query = history.records[history.last_id].query
    assert QUESTION in saved_query and "本月销售额" in saved_query
    assert "销售额还是销量" in saved_query
    assert history.done == [[]]


def test_invalid_parent_is_http_error_before_stream_or_graph(monkeypatch):
    graph = Graph()
    monkeypatch.setattr(service_module, "graph", graph)
    app = FastAPI()
    app.include_router(query_router)
    app.dependency_overrides[get_query_service] = lambda: build(History())
    with TestClient(app) as client:
        response = client.post(
            "/api/query", json={"query": "本月", "parent_history_id": PARENT}
        )
    assert response.status_code == 404
    assert graph.inputs == []


def test_valid_parent_is_resolved_by_server_before_streaming(monkeypatch):
    graph, history = Graph(), History(parent())
    monkeypatch.setattr(service_module, "graph", graph)
    app = FastAPI()
    app.include_router(query_router)
    app.dependency_overrides[get_query_service] = lambda: build(history)
    with TestClient(app) as client:
        response = client.post(
            "/api/query", json={"query": "本月销售额", "parent_history_id": PARENT}
        )
    assert response.status_code == 200
    assert graph.inputs[0]["clarification_context"]["original_query"] == QUESTION
    assert (
        graph.inputs[0]["clarification_context"]["turns"][0]["answer"] == "本月销售额"
    )
