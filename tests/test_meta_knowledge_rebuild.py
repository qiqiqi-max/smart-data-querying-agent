import asyncio
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal

import pytest
import yaml
from qdrant_client import AsyncQdrantClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.conf.app_config import app_config
from app.models.base import Base
from app.models.column_info import ColumnInfoMySQL
from app.models.column_metric import ColumnMetricMySQL
from app.models.metric_info import MetricInfoMySQL
from app.models.table_info import TableInfoMySQL
from app.repositories.es.value_es_repository import ValueESRepository
from app.repositories.mysql.meta.meta_mysql_repository import MetaMySQLRepository
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository
from app.repositories.qdrant.metric_qdrant_repository import MetricQdrantRepository
from app.services.meta_knowledge_service import MetaKnowledgeService


class AsyncSessionAdapter:
    """Use real SQLite SQL/transactions without introducing an async SQLite dependency."""

    def __init__(self, session):
        self.session = session

    @asynccontextmanager
    async def begin(self):
        with self.session.begin():
            yield

    async def execute(self, statement):
        return self.session.execute(statement)

    def add_all(self, rows):
        self.session.add_all(rows)


class Warehouse:
    async def get_column_types(self, table):
        if table != "orders":
            raise ValueError("missing table")
        return {"amount": "decimal(12,2)"}

    async def get_column_values(self, table, column, limit=10):
        return ["100"]


class Embeddings:
    async def aembed_documents(self, texts):
        return [[1.0, 0.0, 0.0] for _ in texts]


def configured_data():
    return {
        "tables": [
            {
                "name": "orders",
                "role": "fact",
                "description": "订单",
                "columns": [
                    {
                        "name": "amount",
                        "role": "measure",
                        "description": "金额",
                        "alias": [],
                        "sync": True,
                    }
                ],
            }
        ],
        "metrics": [
            {
                "name": "销售额",
                "description": "金额合计",
                "alias": [],
                "relevant_columns": ["orders.amount"],
            }
        ],
    }


def make_service(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "local_mode", True)
    monkeypatch.setattr(app_config.qdrant, "embedding_size", 3)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine)
    with session.begin():
        session.add_all(
            [
                TableInfoMySQL(id="obsolete", name="obsolete"),
                ColumnInfoMySQL(id="obsolete.id", name="id", table_id="obsolete"),
                MetricInfoMySQL(id="obsolete_metric", name="obsolete_metric"),
                ColumnMetricMySQL(column_id="obsolete.id", metric_id="obsolete_metric"),
            ]
        )
    qdrant = AsyncQdrantClient(":memory:")
    service = MetaKnowledgeService(
        MetaMySQLRepository(AsyncSessionAdapter(session)),
        Warehouse(),
        ColumnQdrantRepository(qdrant),
        Embeddings(),
        ValueESRepository(None, tmp_path / "values.json"),
        MetricQdrantRepository(qdrant),
    )
    return service, session, qdrant, engine


def test_full_rebuild_removes_deleted_metadata_and_empty_rebuild_clears_indexes(
    tmp_path, monkeypatch
):
    service, session, qdrant, engine = make_service(tmp_path, monkeypatch)
    path = tmp_path / "meta.yaml"
    path.write_text(
        yaml.safe_dump(configured_data(), allow_unicode=True), encoding="utf-8"
    )
    progress = []

    async def exercise():
        await service.build(
            path, full_replace=True, progress=lambda *stage: progress.append(stage)
        )
        assert session.scalars(select(TableInfoMySQL.id)).all() == ["orders"]
        assert session.scalars(select(ColumnInfoMySQL.id)).all() == ["orders.amount"]
        assert session.scalars(select(MetricInfoMySQL.id)).all() == ["销售额"]
        assert session.scalars(select(ColumnMetricMySQL.column_id)).all() == [
            "orders.amount"
        ]
        session.rollback()
        assert [
            item.value for item in await service.value_es_repository.search("100")
        ] == ["100"]
        assert (await qdrant.count("column_info_collection")).count == 2
        assert (await qdrant.count("metric_info_collection")).count == 2
        assert [stage[1] for stage in progress] == [1, 2, 3, 4, 5, 6]
        path.write_text("tables: []\nmetrics: []\n", encoding="utf-8")
        await service.build(path, full_replace=True)
        assert session.scalars(select(TableInfoMySQL.id)).all() == []
        assert session.scalars(select(ColumnInfoMySQL.id)).all() == []
        assert session.scalars(select(MetricInfoMySQL.id)).all() == []
        assert session.scalars(select(ColumnMetricMySQL.column_id)).all() == []
        assert await service.value_es_repository.search("100") == []
        assert (await qdrant.count("column_info_collection")).count == 0
        assert (await qdrant.count("metric_info_collection")).count == 0

    try:
        asyncio.run(exercise())
    finally:
        asyncio.run(qdrant.close())
        session.close()
        engine.dispose()


def test_missing_dw_column_fails_before_deleting_existing_metadata(
    tmp_path, monkeypatch
):
    service, session, qdrant, engine = make_service(tmp_path, monkeypatch)
    data = configured_data()
    data["tables"][0]["columns"][0]["name"] = "missing"
    data["metrics"][0]["relevant_columns"] = ["orders.missing"]
    path = tmp_path / "meta.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    try:
        with pytest.raises(ValueError, match="orders.missing"):
            asyncio.run(service.build(path, full_replace=True))
        assert session.scalars(select(TableInfoMySQL.id)).all() == ["obsolete"]
        assert session.scalars(select(ColumnInfoMySQL.id)).all() == ["obsolete.id"]
    finally:
        asyncio.run(qdrant.close())
        session.close()
        engine.dispose()


def test_real_mysql_decimal_and_date_samples_are_json_serializable(
    tmp_path, monkeypatch
):
    service, session, qdrant, engine = make_service(tmp_path, monkeypatch)

    async def values(table, column, limit=10):
        return [Decimal("100.25"), date(2026, 11, 5), None]

    service.dw_mysql_repository.get_column_values = values
    path = tmp_path / "meta.yaml"
    path.write_text(
        yaml.safe_dump(configured_data(), allow_unicode=True), encoding="utf-8"
    )
    try:
        asyncio.run(service.build(path, full_replace=True))
        saved = session.get(ColumnInfoMySQL, "orders.amount")
        assert saved.examples == ["100.25", "2026-11-05", None]
    finally:
        asyncio.run(qdrant.close())
        session.close()
        engine.dispose()


def test_admin_metadata_description_is_literal_not_environment_interpolation(
    tmp_path, monkeypatch
):
    service, session, qdrant, engine = make_service(tmp_path, monkeypatch)
    data = configured_data()
    data["tables"][0]["description"] = "literal ${oc.env:ADMIN_UNSET_TEST_ENV}"
    path = tmp_path / "meta.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    try:
        asyncio.run(service.build(path, full_replace=True))
        assert (
            session.get(TableInfoMySQL, "orders").description
            == "literal ${oc.env:ADMIN_UNSET_TEST_ENV}"
        )
    finally:
        asyncio.run(qdrant.close())
        session.close()
        engine.dispose()


def test_remote_value_reset_removes_stale_values_and_bulk_errors_fail_build(
    monkeypatch,
):
    from app.entities.value_info import ValueInfo

    class Indices:
        def __init__(self):
            self.exists_now = True
            self.documents = {"obsolete": {"value": "old"}}

        async def exists(self, *, index):
            assert index == "value_index"
            return self.exists_now

        async def delete(self, *, index):
            assert index == "value_index"
            self.exists_now = False
            self.documents.clear()

        async def create(self, *, index, mappings):
            assert index == "value_index"
            self.exists_now = True

    class Client:
        indices = Indices()

        async def bulk(self, **kwargs):
            return {
                "errors": True,
                "items": [
                    {"index": {"status": 400, "error": {"reason": "secret-url"}}}
                ],
            }

    monkeypatch.setattr(app_config, "local_mode", False)
    client = Client()
    repository = ValueESRepository(client)

    async def exercise():
        await repository.reset_index()
        assert client.indices.documents == {}
        assert client.indices.exists_now is True
        with pytest.raises(RuntimeError):
            await repository.index([ValueInfo("current", "100", "orders.amount")])

    asyncio.run(exercise())
