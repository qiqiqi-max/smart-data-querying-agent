import asyncio
import json
from types import SimpleNamespace

from langchain_core.runnables import RunnableLambda

from app.agent.nodes import recall_column as recall_column_module
from app.agent.nodes import recall_metric as recall_metric_module
from app.entities.column_info import ColumnInfo
from app.entities.metric_info import MetricInfo

# 每个关键词对应一个固定向量，假仓储再按向量返回预设命中结果
VOCABULARY = ["销售总额", "华北地区", "销售额", "GMV", "订单金额", "地区"]


class _FakeEmbeddingClient:
    def __init__(self):
        self.document_calls: list[list[str]] = []
        self.query_calls: list[str] = []

    async def aembed_documents(self, texts):
        self.document_calls.append(list(texts))
        return [[float(VOCABULARY.index(text))] for text in texts]

    async def aembed_query(self, text):
        self.query_calls.append(text)
        return [float(VOCABULARY.index(text))]


class _FakeQdrantRepository:
    def __init__(self, hits_by_keyword):
        self.hits_by_index = {
            VOCABULARY.index(keyword): hits for keyword, hits in hits_by_keyword.items()
        }
        self.search_calls: list[list[float]] = []

    async def search(self, embedding):
        self.search_calls.append(embedding)
        index = int(embedding[0])
        # 越靠前的关键词返回越慢，确保结果顺序依赖关键词顺序而不是完成顺序
        await asyncio.sleep(0.001 * (len(VOCABULARY) - index))
        return list(self.hits_by_index.get(index, []))


def _column(column_id):
    return ColumnInfo(
        id=column_id,
        name=column_id.split(".")[-1],
        type="varchar",
        role="dimension",
        examples=[],
        description="",
        alias=[],
        table_id=column_id.split(".")[0],
    )


def _metric(metric_id):
    return MetricInfo(
        id=metric_id, name=metric_id, description="", relevant_columns=[], alias=[]
    )


def _fake_llm(extended_keywords):
    # 替换模块级 llm，让 prompt | llm | parser 管道直接得到 JSON 数组
    return RunnableLambda(lambda _prompt: json.dumps(extended_keywords))


def _runtime(**context):
    events = []
    return SimpleNamespace(context=context, stream_writer=events.append), events


async def _reference_recall(keywords, embedding_client, repository):
    """改造前的逐关键词召回逻辑，用来对比结果顺序和去重语义。"""

    info_map = {}
    for keyword in keywords:
        embedding = await embedding_client.aembed_query(keyword)
        for info in await repository.search(embedding):
            if info.id not in info_map:
                info_map[info.id] = info
    return list(info_map.values())


COLUMN_HITS = {
    "销售总额": [_column("fact_order.order_amount"), _column("fact_order.pay_amount")],
    "华北地区": [_column("dim_region.region_name")],
    "销售额": [_column("fact_order.pay_amount"), _column("fact_order.order_amount")],
    "GMV": [_column("fact_order.gmv")],
    "订单金额": [_column("fact_order.order_amount")],
    "地区": [_column("dim_region.region_name"), _column("dim_region.province")],
}

METRIC_HITS = {
    "销售总额": [_metric("metric.gmv"), _metric("metric.pay_amount")],
    "销售额": [_metric("metric.pay_amount")],
    "GMV": [_metric("metric.gmv"), _metric("metric.order_count")],
    "订单金额": [_metric("metric.avg_order_amount")],
}


def test_recall_column_embeds_all_keywords_in_one_batch(monkeypatch):
    monkeypatch.setattr(
        recall_column_module, "llm", _fake_llm(["销售额", "GMV", "订单金额", "地区"])
    )
    embedding_client = _FakeEmbeddingClient()
    repository = _FakeQdrantRepository(COLUMN_HITS)
    runtime, events = _runtime(
        column_qdrant_repository=repository, embedding_client=embedding_client
    )
    state = {
        "query": "华北地区的销售总额",
        "keywords": ["销售总额", "华北地区", "销售额"],
    }

    result = asyncio.run(recall_column_module.recall_column(state, runtime))

    # 原始关键词在前、扩展词在后并保序去重，整体只做一次批量 Embedding
    assert embedding_client.document_calls == [VOCABULARY]
    assert embedding_client.query_calls == []
    assert len(repository.search_calls) == len(VOCABULARY)

    expected = asyncio.run(
        _reference_recall(
            VOCABULARY, _FakeEmbeddingClient(), _FakeQdrantRepository(COLUMN_HITS)
        )
    )
    assert result["retrieved_column_infos"] == expected
    assert [info.id for info in result["retrieved_column_infos"]] == [
        "fact_order.order_amount",
        "fact_order.pay_amount",
        "dim_region.region_name",
        "fact_order.gmv",
        "dim_region.province",
    ]
    assert [event["status"] for event in events] == ["running", "success"]


def test_recall_metric_embeds_all_keywords_in_one_batch(monkeypatch):
    monkeypatch.setattr(
        recall_metric_module, "llm", _fake_llm(["GMV", "销售总额", "订单金额"])
    )
    embedding_client = _FakeEmbeddingClient()
    repository = _FakeQdrantRepository(METRIC_HITS)
    runtime, events = _runtime(
        metric_qdrant_repository=repository, embedding_client=embedding_client
    )
    state = {
        "query": "华北地区的销售总额",
        "keywords": ["销售总额", "华北地区", "销售额"],
    }

    result = asyncio.run(recall_metric_module.recall_metric(state, runtime))

    keywords = ["销售总额", "华北地区", "销售额", "GMV", "订单金额"]
    assert embedding_client.document_calls == [keywords]
    assert embedding_client.query_calls == []

    expected = asyncio.run(
        _reference_recall(
            keywords, _FakeEmbeddingClient(), _FakeQdrantRepository(METRIC_HITS)
        )
    )
    assert result["retrieved_metric_infos"] == expected
    assert [info.id for info in result["retrieved_metric_infos"]] == [
        "metric.gmv",
        "metric.pay_amount",
        "metric.order_count",
        "metric.avg_order_amount",
    ]
    assert [event["status"] for event in events] == ["running", "success"]


def test_recall_nodes_skip_embedding_when_no_keywords(monkeypatch):
    monkeypatch.setattr(recall_column_module, "llm", _fake_llm([]))
    monkeypatch.setattr(recall_metric_module, "llm", _fake_llm([]))
    embedding_client = _FakeEmbeddingClient()
    column_repository = _FakeQdrantRepository(COLUMN_HITS)
    metric_repository = _FakeQdrantRepository(METRIC_HITS)
    runtime, events = _runtime(
        column_qdrant_repository=column_repository,
        metric_qdrant_repository=metric_repository,
        embedding_client=embedding_client,
    )
    state = {"query": "随便看看", "keywords": []}

    column_result = asyncio.run(recall_column_module.recall_column(state, runtime))
    metric_result = asyncio.run(recall_metric_module.recall_metric(state, runtime))

    assert column_result == {"retrieved_column_infos": []}
    assert metric_result == {"retrieved_metric_infos": []}
    assert embedding_client.document_calls == []
    assert embedding_client.query_calls == []
    assert column_repository.search_calls == []
    assert metric_repository.search_calls == []
    assert [event["status"] for event in events] == [
        "running",
        "success",
        "running",
        "success",
    ]
