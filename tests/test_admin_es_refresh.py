import asyncio

from app.conf.app_config import app_config
from app.entities.value_info import ValueInfo
from app.repositories.es.value_es_repository import ValueESRepository


def test_bulk_import_refreshes_once_after_all_batches(monkeypatch):
    monkeypatch.setattr(app_config, "local_mode", False)
    events = []

    class Indices:
        async def refresh(self, **kwargs):
            events.append("refresh")

    class Client:
        indices = Indices()

        async def bulk(self, **kwargs):
            assert kwargs.get("refresh") != "wait_for", (
                "each batch must not wait for a refresh cycle"
            )
            events.append("bulk")
            return {"errors": False}

    repository = ValueESRepository(Client())
    asyncio.run(
        repository.index(
            [ValueInfo(str(i), "v", "c") for i in range(45)], batch_size=20
        )
    )
    assert events == ["bulk", "bulk", "bulk", "refresh"]
