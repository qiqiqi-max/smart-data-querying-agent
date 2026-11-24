import asyncio
import json
from copy import deepcopy

import pytest
import yaml
from fastapi import HTTPException
from pydantic import ValidationError


def metadata_payload():
    return {
        "revision": "initial",
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
                        "alias": ["收入"],
                        "sync": False,
                    }
                ],
            }
        ],
        "metrics": [
            {
                "name": "总收入",
                "description": "金额合计",
                "relevant_columns": ["orders.amount"],
                "alias": [],
            }
        ],
    }


def service_for(tmp_path):
    from app.services.admin_knowledge import AdminKnowledgeService

    config = tmp_path / "meta.yaml"
    payload = metadata_payload()
    payload.pop("revision")
    config.write_text(yaml.safe_dump(payload, allow_unicode=True), encoding="utf-8")
    return AdminKnowledgeService(config, tmp_path / "admin")


@pytest.mark.parametrize(
    "invalid",
    [
        "duplicate_table",
        "duplicate_column",
        "duplicate_metric",
        "bad_name",
        "missing_reference",
        "duplicate_reference",
        "long_column_id",
    ],
)
def test_metadata_rejects_invalid_schema(invalid):
    from app.api.schemas.admin_knowledge_schema import MetadataUpdate

    payload = metadata_payload()
    if invalid == "duplicate_table":
        payload["tables"].append(deepcopy(payload["tables"][0]))
    elif invalid == "duplicate_column":
        payload["tables"][0]["columns"].append(
            deepcopy(payload["tables"][0]["columns"][0])
        )
    elif invalid == "duplicate_metric":
        payload["metrics"].append(deepcopy(payload["metrics"][0]))
    elif invalid == "bad_name":
        payload["tables"][0]["name"] = "orders; drop table orders"
    elif invalid == "missing_reference":
        payload["metrics"][0]["relevant_columns"] = ["orders.missing"]
    elif invalid == "duplicate_reference":
        payload["metrics"][0]["relevant_columns"] *= 2
    else:
        payload["tables"][0]["name"] = "a" * 60
        payload["metrics"][0]["relevant_columns"] = ["a" * 60 + ".amount"]
    with pytest.raises(ValidationError):
        MetadataUpdate.model_validate(payload)


def test_metadata_save_is_persistent_and_rejects_stale_edits(tmp_path):
    from app.api.schemas.admin_knowledge_schema import MetadataUpdate

    service = service_for(tmp_path)
    before = service.read_metadata()
    payload = metadata_payload()
    payload["revision"] = before["revision"]
    payload["tables"][0]["description"] = "已修改订单"
    saved = service.save_metadata(MetadataUpdate.model_validate(payload))
    assert saved["revision"] != before["revision"]
    assert saved["dirty"] is True
    assert service.read_metadata()["tables"][0]["description"] == "已修改订单"
    with pytest.raises(HTTPException) as error:
        service.save_metadata(MetadataUpdate.model_validate(payload))
    assert error.value.status_code == 409
    assert (
        yaml.safe_load(service.config_path.read_text(encoding="utf-8"))["tables"][0][
            "description"
        ]
        == "已修改订单"
    )


def test_maintenance_excludes_queries_and_stays_blocked_after_failure():
    from app.core.maintenance import MaintenanceState

    gate = MaintenanceState()

    async def exercise():
        async with gate.query():
            assert gate.snapshot()["active_queries"] == 1
            with pytest.raises(HTTPException) as error:
                gate.start_build()
            assert error.value.status_code == 409
        gate.start_build()
        with pytest.raises(HTTPException):
            async with gate.query():
                pytest.fail("query entered during build")
        gate.finish_build(False)
        assert gate.snapshot() == {
            "building": False,
            "blocked": True,
            "active_queries": 0,
        }
        gate.start_build()
        gate.finish_build(True)
        async with gate.query():
            pass
        assert gate.snapshot()["active_queries"] == 0

    asyncio.run(exercise())


def test_query_counter_is_released_on_cancellation():
    from app.core.maintenance import MaintenanceState

    gate = MaintenanceState()

    async def exercise():
        with pytest.raises(asyncio.CancelledError):
            async with gate.query():
                raise asyncio.CancelledError()
        assert gate.snapshot()["active_queries"] == 0
        gate.start_build()

    asyncio.run(exercise())


def test_build_failure_is_sanitized_and_success_unlocks(tmp_path, monkeypatch):
    import app.services.admin_knowledge as module
    from app.core.maintenance import MaintenanceState

    gate = MaintenanceState()
    monkeypatch.setattr(module, "maintenance", gate)
    service = service_for(tmp_path)

    async def fails(config_path, progress):
        progress("校验完成", 1, 6)
        raise RuntimeError("mysql://admin:top-secret@localhost/private")

    async def succeeds(config_path, progress):
        progress("构建完成", 6, 6)

    async def wait_for_job():
        for _ in range(100):
            await asyncio.sleep(0)
            if not gate.snapshot()["building"]:
                return
        pytest.fail("build did not finish")

    async def exercise():
        monkeypatch.setattr(service, "_execute_build", fails)
        first = await service.start_build()
        assert first["status"] == "queued"
        await wait_for_job()
        failed = service.list_builds()["items"][0]
        assert failed["status"] == "error"
        assert "top-secret" not in json.dumps(failed)
        assert gate.snapshot()["blocked"] is True
        monkeypatch.setattr(service, "_execute_build", succeeds)
        await service.start_build()
        await wait_for_job()
        assert service.list_builds()["items"][0]["status"] == "done"
        assert service.read_metadata()["dirty"] is False
        assert gate.snapshot()["blocked"] is False
        await service.close()

    asyncio.run(exercise())


def test_build_state_write_failure_is_observed_and_leaves_queries_blocked(
    tmp_path, monkeypatch
):
    import app.services.admin_knowledge as module
    from app.core.maintenance import MaintenanceState

    gate = MaintenanceState()
    monkeypatch.setattr(module, "maintenance", gate)
    service = service_for(tmp_path)

    def write_fails(*args, **kwargs):
        raise OSError("failed disk secret-path")

    async def exercise():
        await service.start_build()
        task = next(iter(service._tasks))
        monkeypatch.setattr(service, "_update_build", write_fails)
        await task
        assert gate.snapshot() == {
            "building": False,
            "blocked": True,
            "active_queries": 0,
        }
        await service.close()

    asyncio.run(exercise())


def test_recovery_marks_unfinished_job_interrupted_and_blocks_queries(
    tmp_path, monkeypatch
):
    import app.services.admin_knowledge as module
    from app.core.maintenance import MaintenanceState

    gate = MaintenanceState()
    monkeypatch.setattr(module, "maintenance", gate)
    service = service_for(tmp_path)

    async def unfinished(config_path, progress):
        await asyncio.Event().wait()

    async def exercise():
        monkeypatch.setattr(service, "_execute_build", unfinished)
        await service.start_build()
        await asyncio.sleep(0)
        await service.close()

    asyncio.run(exercise())
    restarted = module.AdminKnowledgeService(service.config_path, tmp_path / "admin")
    restarted.recover()
    assert restarted.list_builds()["items"][0]["status"] == "interrupted"
    assert gate.snapshot()["blocked"] is True


def test_metadata_concurrent_edit_has_one_winner_and_atomic_failure_keeps_file(
    tmp_path, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path

    from app.api.schemas.admin_knowledge_schema import MetadataUpdate

    service = service_for(tmp_path)
    before = service.read_metadata()
    payload = metadata_payload()
    payload["revision"] = before["revision"]
    payload["tables"][0]["description"] = "modified"
    update = MetadataUpdate.model_validate(payload)

    def save():
        try:
            service.save_metadata(update)
            return "saved"
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: save(), range(2)))
    assert sorted(str(value) for value in results) == ["409", "saved"]
    saved = service.config_path.read_bytes()
    update.revision = service.read_metadata()["revision"]
    update.tables[0].description = "must not persist"
    original_replace = Path.replace

    def fails_replace(source, destination):
        if destination == service.config_path:
            raise OSError("disk failed")
        return original_replace(source, destination)

    monkeypatch.setattr(Path, "replace", fails_replace)
    with pytest.raises(OSError):
        service.save_metadata(update)
    assert service.config_path.read_bytes() == saved
    assert list(tmp_path.glob("*.tmp")) == []


def test_build_uses_saved_snapshot_blocks_edits_and_keeps_latest_fifty(
    tmp_path, monkeypatch
):
    import app.services.admin_knowledge as module
    from app.api.schemas.admin_knowledge_schema import MetadataUpdate
    from app.core.maintenance import MaintenanceState

    gate = MaintenanceState()
    monkeypatch.setattr(module, "maintenance", gate)
    service = service_for(tmp_path)
    original = service.read_metadata()
    seen = []

    async def build(path, progress):
        seen.append(
            yaml.safe_load(path.read_text(encoding="utf-8"))["tables"][0]["description"]
        )

    async def exercise():
        monkeypatch.setattr(service, "_execute_build", build)
        first = await service.start_build()
        assert first["revision"] == original["revision"]
        with pytest.raises(HTTPException) as conflict:
            service.save_metadata(
                MetadataUpdate.model_validate(
                    {key: original[key] for key in ("revision", "tables", "metrics")}
                )
            )
        assert conflict.value.status_code == 409
        # External edits cannot alter the configuration captured by a queued job.
        service.config_path.write_text(
            service.config_path.read_text(encoding="utf-8").replace("订单", "新订单"),
            encoding="utf-8",
        )
        for _ in range(100):
            await asyncio.sleep(0)
            if not gate.snapshot()["building"]:
                break
        assert seen == ["订单"]
        assert service.read_metadata()["dirty"] is True
        for _ in range(51):
            await service.start_build()
            for _ in range(100):
                await asyncio.sleep(0)
                if not gate.snapshot()["building"]:
                    break
        builds = service.list_builds()["items"]
        assert len(builds) == 50
        assert all(item["id"] != first["id"] for item in builds)
        await service.close()

    asyncio.run(exercise())
