"""用假模型和假仓储把整张 LangGraph 图跑一遍，覆盖节点之间的数据传递和分支。"""

import asyncio
import json

import pytest
from langchain_core.runnables import RunnableLambda

from app.agent import graph as graph_module
from app.agent.context import DataAgentContext
from app.agent.nodes import correct_sql as correct_sql_module
from app.agent.nodes import filter_metric as filter_metric_module
from app.agent.nodes import filter_table as filter_table_module
from app.agent.nodes import generate_sql as generate_sql_module
from app.agent.nodes import recall_column as recall_column_module
from app.agent.nodes import recall_metric as recall_metric_module
from app.agent.nodes import recall_value as recall_value_module
from app.agent.state import DataAgentState
from app.entities.column_info import ColumnInfo
from app.entities.metric_info import MetricInfo
from app.entities.table_info import TableInfo
from app.entities.value_info import ValueInfo
from app.services import query_service as query_service_module
from app.services.query_service import QueryService

QUERY = "统计华北地区的销售总额"
GENERATED_SQL = (
    "SELECT SUM(f.order_amount) AS total FROM fact_order f "
    "JOIN dim_region r ON f.region_id = r.region_id WHERE r.region_name = '华北'"
)
CORRECTED_SQL = GENERATED_SQL.replace("total", "sales_total")
ROWS = [{"sales_total": 41099.5}]


def _column(column_id, role="dimension", examples=None):
    table_id, name = column_id.split(".")
    return ColumnInfo(
        id=column_id,
        name=name,
        type="varchar",
        role=role,
        examples=list(examples or []),
        description="",
        alias=[],
        table_id=table_id,
    )


COLUMNS = {
    column.id: column
    for column in [
        _column("fact_order.order_amount", role="measure"),
        _column("fact_order.region_id", role="foreign_key"),
        _column("fact_order.order_id", role="primary_key"),
        _column("dim_region.region_name"),
        _column("dim_region.region_id", role="primary_key"),
    ]
}
KEY_COLUMNS = {
    "fact_order": ["fact_order.order_id", "fact_order.region_id"],
    "dim_region": ["dim_region.region_id"],
}
GMV = MetricInfo(
    id="metric.gmv",
    name="GMV",
    description="成交总额",
    relevant_columns=["fact_order.order_amount"],
    alias=["销售总额"],
)


def _copy(column):
    # 节点会往 examples 里追加取值，每次返回新对象，避免测试之间互相污染
    return ColumnInfo(**{**column.__dict__, "examples": list(column.examples)})


class _FakeEmbeddingClient:
    async def aembed_documents(self, texts):
        return [[float(index)] for index, _ in enumerate(texts)]


class _FakeColumnRepository:
    async def search(self, embedding):
        return [_copy(COLUMNS["fact_order.order_amount"])] if embedding[0] == 0 else []


class _FakeMetricRepository:
    async def search(self, embedding):
        return [GMV] if embedding[0] == 0 else []


class _FakeValueRepository:
    async def search(self, keyword, *args, **kwargs):
        if "华北" in keyword:
            return [ValueInfo("v1", "华北", "dim_region.region_name")]
        return []


class _FakeMetaRepository:
    async def get_column_info_by_id(self, column_id):
        return _copy(COLUMNS[column_id])

    async def get_key_columns_by_table_id(self, table_id):
        return [_copy(COLUMNS[column_id]) for column_id in KEY_COLUMNS[table_id]]

    async def get_table_info_by_id(self, table_id):
        return TableInfo(id=table_id, name=table_id, role="fact", description="")


class _FakeDWRepository:
    def __init__(self, validation_errors=()):
        # 依次决定每次校验的结果：None 表示通过，字符串表示数据库报错
        self.validation_errors = list(validation_errors)
        self.validated: list[str] = []
        self.ran: list[str] = []

    async def get_db_info(self):
        return {"dialect": "mysql", "version": "8.0.37"}

    async def validate(self, sql):
        self.validated.append(sql)
        error = self.validation_errors.pop(0) if self.validation_errors else None
        if error:
            raise ValueError(error)

    async def run(self, sql):
        self.ran.append(sql)
        return list(ROWS), False


class _LLMCalls:
    def __init__(self):
        self.prompts: dict[str, list[str]] = {}

    def fake(self, name, response):
        """生成替换模块级 llm 的 Runnable，并记录每次收到的提示词。"""

        def answer(prompt_value):
            self.prompts.setdefault(name, []).append(prompt_value.to_string())
            return response() if callable(response) else response

        return RunnableLambda(answer)


def _install_fake_llms(monkeypatch, correct_sql_response=CORRECTED_SQL):
    calls = _LLMCalls()
    responses = {
        recall_column_module: ("recall_column", json.dumps(["订单金额"])),
        recall_metric_module: ("recall_metric", json.dumps(["GMV"])),
        recall_value_module: ("recall_value", json.dumps(["华北"])),
        filter_table_module: (
            "filter_table",
            json.dumps(
                {
                    "fact_order": ["order_amount", "region_id"],
                    "dim_region": ["region_name", "region_id"],
                }
            ),
        ),
        filter_metric_module: ("filter_metric", json.dumps(["GMV"])),
        # 模型偶尔会包上代码块，生成节点应当清洗掉
        generate_sql_module: ("generate_sql", f"```sql\n{GENERATED_SQL}\n```"),
        correct_sql_module: ("correct_sql", correct_sql_response),
    }
    for module, (name, response) in responses.items():
        monkeypatch.setattr(module, "llm", calls.fake(name, response))
    return calls


def _context(dw_repository):
    return DataAgentContext(
        column_qdrant_repository=_FakeColumnRepository(),
        embedding_client=_FakeEmbeddingClient(),
        metric_qdrant_repository=_FakeMetricRepository(),
        value_es_repository=_FakeValueRepository(),
        meta_mysql_repository=_FakeMetaRepository(),
        dw_mysql_repository=dw_repository,
    )


def _run_graph(dw_repository):
    async def exercise():
        events, final_state = [], None
        async for mode, chunk in graph_module.graph.astream(
            input=DataAgentState(query=QUERY),
            context=_context(dw_repository),
            stream_mode=["custom", "values"],
        ):
            if mode == "custom":
                events.append(chunk)
            else:
                final_state = chunk
        return events, final_state

    return asyncio.run(exercise())


def _progress(events):
    return [
        (event["step"], event["status"])
        for event in events
        if event["type"] == "progress"
    ]


NODE_STEPS = [
    "抽取关键词",
    "召回字段信息",
    "召回字段取值",
    "召回指标信息",
    "合并召回信息",
    "过滤表信息",
    "过滤指标信息",
    "添加额外上下文",
    "生成SQL",
    "校验SQL",
    "执行SQL",
]


def test_graph_happy_path_runs_every_node_and_returns_rows(monkeypatch):
    calls = _install_fake_llms(monkeypatch)
    dw_repository = _FakeDWRepository()

    events, state = _run_graph(dw_repository)

    progress = _progress(events)
    for step in NODE_STEPS:
        assert (step, "running") in progress
        assert (step, "success") in progress
    assert "correct_sql" not in calls.prompts
    assert progress[-1] == ("执行SQL", "success")
    assert events[-1] == {"type": "result", "data": ROWS, "truncated": False}

    # 生成节点去掉了代码块围栏，校验和执行拿到的是同一条 SQL
    assert dw_repository.validated == [GENERATED_SQL]
    assert dw_repository.ran == [GENERATED_SQL]

    # 合并节点补齐了指标依赖字段、取值样例和主外键，过滤节点按模型选择裁剪
    tables = {table["name"]: table for table in state["table_infos"]}
    assert set(tables) == {"fact_order", "dim_region"}
    region_columns = {
        column["name"]: column for column in tables["dim_region"]["columns"]
    }
    assert region_columns["region_name"]["examples"] == ["华北"]
    assert "order_id" not in {
        column["name"] for column in tables["fact_order"]["columns"]
    }
    assert [metric["name"] for metric in state["metric_infos"]] == ["GMV"]
    assert state["db_info"] == {"dialect": "mysql", "version": "8.0.37"}

    # SQL 生成提示词里能看到上游整理的表、取值和数据库信息
    generate_prompt = calls.prompts["generate_sql"][0]
    assert "dim_region" in generate_prompt and "华北" in generate_prompt
    assert "8.0.37" in generate_prompt


def test_graph_corrects_sql_once_after_validation_error(monkeypatch):
    calls = _install_fake_llms(monkeypatch)
    dw_repository = _FakeDWRepository(["Unknown column 'total'"])

    events, state = _run_graph(dw_repository)

    assert dw_repository.validated == [GENERATED_SQL, CORRECTED_SQL]
    assert dw_repository.ran == [CORRECTED_SQL]
    assert len(calls.prompts["correct_sql"]) == 1
    # 修正提示词带上了原 SQL 和数据库报错
    assert "Unknown column 'total'" in calls.prompts["correct_sql"][0]
    assert GENERATED_SQL in calls.prompts["correct_sql"][0]
    assert state["sql_retry_count"] == 1
    assert [attempt["error"] for attempt in state["sql_attempts"]] == [
        "Unknown column 'total'",
        None,
    ]
    progress = _progress(events)
    assert progress.index(("校验SQL", "error")) < progress.index(("校正SQL", "success"))
    assert events[-1]["type"] == "result"


def test_graph_stops_after_max_corrections_without_running_sql(monkeypatch):
    calls = _install_fake_llms(monkeypatch, correct_sql_response="SELECT broken")
    errors = ["bad sql 1", "bad sql 2", "bad sql 3"]
    dw_repository = _FakeDWRepository(errors)

    events, state = _run_graph(dw_repository)

    max_corrections = graph_module.MAX_SQL_CORRECTIONS
    assert len(calls.prompts["correct_sql"]) == max_corrections
    assert len(dw_repository.validated) == max_corrections + 1
    assert dw_repository.ran == []
    assert state["sql_retry_count"] == max_corrections
    assert events[-1] == {"type": "error", "message": "bad sql 3"}
    assert ("SQL校验失败", "error") in _progress(events)
    assert not any(event["type"] == "result" for event in events)


def test_graph_propagates_node_failure(monkeypatch):
    _install_fake_llms(monkeypatch)
    dw_repository = _FakeDWRepository()

    async def broken_db_info():
        raise RuntimeError("dw unavailable")

    dw_repository.get_db_info = broken_db_info

    with pytest.raises(RuntimeError, match="dw unavailable"):
        _run_graph(dw_repository)
    assert dw_repository.ran == []


class _FakeHistoryRepository:
    def __init__(self):
        self.done = []
        self.errors = []

    async def create(self, history_id, query):
        pass

    async def mark_done(self, history_id, result, summary):
        self.done.append((result, summary))

    async def mark_error(self, history_id, message):
        self.errors.append(message)


def test_query_service_streams_graph_events_as_sse(monkeypatch):
    _install_fake_llms(monkeypatch)
    dw_repository = _FakeDWRepository()
    history_repository = _FakeHistoryRepository()
    context = _context(dw_repository)
    service = QueryService(
        meta_mysql_repository=context["meta_mysql_repository"],
        embedding_client=context["embedding_client"],
        dw_mysql_repository=dw_repository,
        column_qdrant_repository=context["column_qdrant_repository"],
        metric_qdrant_repository=context["metric_qdrant_repository"],
        value_es_repository=context["value_es_repository"],
        query_history_repository=history_repository,
        meta_session_factory=None,
    )
    assert query_service_module.graph is graph_module.graph

    async def exercise():
        return [chunk async for chunk in service.query(QUERY)]

    chunks = asyncio.run(exercise())

    assert all(
        chunk.startswith("data: ") and chunk.endswith("\n\n") for chunk in chunks
    )
    events = [json.loads(chunk.removeprefix("data: ")) for chunk in chunks]
    assert events[-1] == {"type": "result", "data": ROWS, "truncated": False}
    assert history_repository.done == [(ROWS, "查询完成，共 1 行结果。")]
    assert history_repository.errors == []


def test_frontend_step_names_match_backend_nodes():
    """前端步骤列表按名称匹配进度事件，名称不一致会让步骤一直停在等待中。"""

    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    backend_steps = set()
    for path in (root / "app" / "agent" / "nodes").glob("*.py"):
        backend_steps.update(
            re.findall(r'step = "([^"]+)"', path.read_text(encoding="utf-8"))
        )
    step_rail = (root / "frontend" / "src" / "components" / "StepRail.tsx").read_text(
        encoding="utf-8"
    )
    step_order = re.search(r"const stepOrder = \[(.*?)\];", step_rail, re.DOTALL)
    frontend_steps = re.findall(r'"([^"]+)"', step_order.group(1))

    assert frontend_steps
    assert set(frontend_steps) - backend_steps == set()
