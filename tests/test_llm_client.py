import asyncio
import json
import time

import httpx
import pytest
import requests
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.agent.llm import RequestsChatModel


def _make_llm(handler=None, base_url="https://relay.example/v1/"):
    transport = httpx.MockTransport(handler) if handler is not None else None
    return RequestsChatModel(
        model_name="test-model",
        base_url=base_url,
        api_key="sk-test",
        temperature=0,
        async_transport=transport,
    )


def _ok(content):
    return httpx.Response(
        200, json={"choices": [{"message": {"role": "assistant", "content": content}}]}
    )


def test_async_request_shape_matches_openai_compatible_api():
    captured = {}

    def handler(request: httpx.Request):
        captured["request"] = request
        return _ok("回答")

    llm = _make_llm(handler)
    messages = [
        SystemMessage(content="系统提示"),
        HumanMessage(content="问题"),
        AIMessage(content="上一轮回答"),
    ]

    result = asyncio.run(llm.ainvoke(messages))

    request = captured["request"]
    assert result.content == "回答"
    assert request.method == "POST"
    assert str(request.url) == "https://relay.example/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer sk-test"
    assert request.headers["Content-Type"] == "application/json"
    assert json.loads(request.content) == {
        "model": "test-model",
        "messages": [
            {"role": "system", "content": "系统提示"},
            {"role": "user", "content": "问题"},
            {"role": "assistant", "content": "上一轮回答"},
        ],
        "temperature": 0,
    }


def test_sync_path_sends_same_payload(monkeypatch):
    captured = {}

    class _FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "同步回答"}}]}

    def fake_post(url, headers, json, timeout):
        captured.update(url=url, headers=headers, json=json, timeout=timeout)
        return _FakeResponse()

    monkeypatch.setattr(requests, "post", fake_post)
    llm = _make_llm()

    result = llm.invoke("问题")

    assert result.content == "同步回答"
    assert captured["url"] == "https://relay.example/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-test"
    assert captured["json"] == llm._build_body([HumanMessage(content="问题")])
    assert captured["timeout"] == 120


def test_async_stop_token_truncates_content():
    llm = _make_llm(lambda request: _ok("SELECT 1;\nEND 多余内容"))

    result = asyncio.run(llm.ainvoke("问题", stop=["END"]))

    assert result.content == "SELECT 1;\n"


def test_async_http_error_raises():
    llm = _make_llm(lambda request: httpx.Response(502, text="bad gateway"))

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(llm.ainvoke("问题"))


def test_cancelling_ainvoke_aborts_in_flight_request():
    state = {"started": None, "finished": False}

    async def handler(request: httpx.Request):
        state["started"].set()
        # 模拟上游迟迟不返回；取消生效时这里会被直接打断
        await asyncio.sleep(30)
        state["finished"] = True
        return _ok("不应返回")

    llm = _make_llm(handler)

    async def scenario():
        state["started"] = asyncio.Event()
        task = asyncio.create_task(llm.ainvoke("问题"))
        await asyncio.wait_for(state["started"].wait(), timeout=5)

        begin = time.perf_counter()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return time.perf_counter() - begin

    elapsed = asyncio.run(scenario())

    assert elapsed < 1
    assert state["finished"] is False


def test_resolve_proxy_follows_requests_env_rules(monkeypatch):
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv(name.lower(), raising=False)
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:7897")
    # httpx 自己解析这里的 "::1" 会报 InvalidURL，requests 规则可以正常处理
    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1,::1,[::1]")

    assert _make_llm()._resolve_proxy() == "http://127.0.0.1:7897"
    assert _make_llm(base_url="http://localhost:8000/v1")._resolve_proxy() is None
