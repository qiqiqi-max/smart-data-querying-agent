from copy import deepcopy
from datetime import datetime

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_meta_session, get_query_history_repository
from app.api.routers import admin_router as module
from app.conf.app_config import app_config
from app.models.query_history import QueryHistoryMySQL
from app.repositories.mysql.meta.query_history_repository import QueryHistoryRepository
from app.services.admin_audit import AdminAudit
from app.services.admin_knowledge import AdminKnowledgeService
from app.services.admin_settings import AdminSettingsService


class AsyncAdapter:
    def __init__(self, session):
        self.session = session

    async def execute(self, query):
        return self.session.execute(query)

    async def get(self, model, key):
        return self.session.get(model, key)

    async def delete(self, model):
        self.session.delete(model)

    async def commit(self):
        self.session.commit()


@pytest.fixture
def client(tmp_path, monkeypatch):
    config = deepcopy(app_config)
    config.llm.api_key = "secret-not-for-response"
    settings = AdminSettingsService(tmp_path / "settings.json", config)
    metadata_path = tmp_path / "meta.yaml"
    metadata_path.write_text(
        yaml.safe_dump({"tables": [], "metrics": []}), encoding="utf-8"
    )
    knowledge = AdminKnowledgeService(metadata_path, tmp_path)
    monkeypatch.setattr(module, "settings_service", settings)
    monkeypatch.setattr(module, "knowledge_service", knowledge)
    monkeypatch.setattr(module, "audit", AdminAudit(tmp_path / "audit.json"))
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    QueryHistoryMySQL.__table__.create(engine)
    with Session(engine) as session:
        session.add(
            QueryHistoryMySQL(
                id="done",
                query="sales",
                status="done",
                row_count=1,
                result=[{"amount": 42}],
                sql="SELECT 42",
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
        )
        session.commit()
    app = FastAPI()
    app.include_router(module.admin_router)

    async def session_dep():
        with Session(engine) as session:
            yield AsyncAdapter(session)

    async def repo_dep():
        with Session(engine) as session:
            yield QueryHistoryRepository(AsyncAdapter(session))

    app.dependency_overrides[get_meta_session] = session_dep
    app.dependency_overrides[get_query_history_repository] = repo_dep
    with TestClient(
        app, base_url="http://127.0.0.1", client=("127.0.0.1", 4000)
    ) as client:
        yield client
    engine.dispose()


def test_admin_settings_save_read_conflict_and_audit(client):
    initial = client.get("/api/admin/settings").json()
    payload = {"revision": initial["revision"]}
    for name, values in initial["saved"].items():
        payload[name] = {k: v for k, v in values.items() if not k.endswith("_set")}
    payload["llm"]["model_name"] = "new-model"
    response = client.put("/api/admin/settings", json=payload)
    assert response.status_code == 200
    assert response.json()["restart_required"]
    assert "secret-not-for-response" not in response.text
    assert client.put("/api/admin/settings", json=payload).status_code == 409
    assert (
        client.get("/api/admin/audit").json()["items"][0]["action"] == "settings.save"
    )


def test_metadata_write_roundtrip_validation_and_conflict(client):
    original = client.get("/api/admin/metadata").json()
    payload = {
        "revision": original["revision"],
        "tables": [
            {
                "name": "orders",
                "role": "fact",
                "description": "Orders",
                "columns": [
                    {
                        "name": "amount",
                        "role": "measure",
                        "description": "Amount",
                        "alias": [],
                        "sync": False,
                    }
                ],
            }
        ],
        "metrics": [],
    }
    saved = client.put("/api/admin/metadata", json=payload)
    assert saved.status_code == 200
    assert saved.json()["dirty"]
    assert client.get("/api/admin/metadata").json()["tables"][0]["name"] == "orders"
    assert client.put("/api/admin/metadata", json=payload).status_code == 409
    payload["revision"] = saved.json()["revision"]
    payload["metrics"] = [
        {
            "name": "broken",
            "description": "",
            "alias": [],
            "relevant_columns": ["absent.column"],
        }
    ]
    assert client.put("/api/admin/metadata", json=payload).status_code == 422


def test_history_detail_delete_and_audit(client):
    listed = client.get("/api/admin/queries?q=sales&page_size=1").json()
    assert listed["total"] == 1 and "result" not in listed["items"][0]
    assert client.get("/api/admin/queries/done").json()["result"] == [{"amount": 42}]
    assert client.delete("/api/admin/queries/done").status_code == 204
    assert client.get("/api/admin/queries/done").status_code == 404
    assert client.get("/api/admin/audit").json()["items"][0]["action"] == "query.delete"
