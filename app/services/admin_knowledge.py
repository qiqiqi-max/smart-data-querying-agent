"""元数据文件编辑与可恢复的进程内知识库构建任务。"""

import asyncio
import hashlib
import json
from contextlib import suppress
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

import yaml
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.schemas.admin_knowledge_schema import MetadataUpdate
from app.core.log import logger
from app.core.maintenance import maintenance


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(contents, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class AdminKnowledgeService:
    def __init__(self, config_path: Path, state_dir: Path):
        self.config_path = config_path
        self.state_dir = state_dir
        self._state_path = state_dir / "knowledge.json"
        self._lock = RLock()
        self._tasks: set[asyncio.Task] = set()
        self.on_complete = None

    def _state(self) -> dict:
        if not self._state_path.exists():
            return {"built_revision": None, "builds": []}
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data["builds"], list):
                raise ValueError("invalid state")
            return data
        except ValueError, KeyError, TypeError:
            raise HTTPException(500, "知识库任务状态文件损坏，请恢复备份") from None

    def _save_state(self, state: dict) -> None:
        state["builds"] = state["builds"][:50]
        _atomic_write(self._state_path, json.dumps(state, ensure_ascii=False, indent=2))

    def read_metadata(self) -> dict:
        with self._lock:
            try:
                raw = self.config_path.read_bytes()
                data = yaml.safe_load(raw) or {}
                data = {
                    "tables": data.get("tables") or [],
                    "metrics": data.get("metrics") or [],
                }
                revision = hashlib.sha256(raw).hexdigest()
                payload = MetadataUpdate.model_validate({"revision": revision, **data})
            except OSError, yaml.YAMLError, ValidationError, AttributeError:
                raise HTTPException(
                    500, "元数据配置无法读取或校验失败，请检查配置文件"
                ) from None
            state = self._state()
            built_revision = state.get("built_revision")
            return {
                **payload.model_dump(),
                "built_revision": built_revision,
                "dirty": built_revision != revision,
            }

    def save_metadata(self, payload: MetadataUpdate) -> dict:
        with self._lock:
            if maintenance.snapshot()["building"]:
                raise HTTPException(409, "知识库构建期间不能修改元数据")
            current = self.read_metadata()
            if payload.revision != current["revision"]:
                raise HTTPException(409, "元数据已被更新，请刷新后重试")
            data = payload.model_dump(exclude={"revision"})
            _atomic_write(
                self.config_path,
                yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
            )
            return self.read_metadata()

    def list_builds(self) -> dict:
        with self._lock:
            return {"items": deepcopy(self._state()["builds"])}

    def recover(self) -> None:
        with self._lock:
            state = self._state()
            for build in state["builds"]:
                if build["status"] in {"queued", "running"}:
                    build.update(
                        status="interrupted",
                        stage="构建已中断",
                        error="服务重启中断了构建，请重新构建",
                        updated_at=_now(),
                    )
            if state["builds"]:
                maintenance.finish_build(state["builds"][0]["status"] == "done")
                self._save_state(state)
            for snapshot in self.state_dir.glob("build-*.yaml"):
                snapshot.unlink(missing_ok=True)

    async def start_build(self) -> dict:
        with self._lock:
            metadata = self.read_metadata()
            maintenance.start_build()
            build_id = uuid4().hex
            snapshot = self.state_dir / f"build-{build_id}.yaml"
            build = {
                "id": build_id,
                "status": "queued",
                "stage": "等待构建",
                "completed_stages": 0,
                "total_stages": 6,
                "created_at": _now(),
                "updated_at": _now(),
                "error": None,
                "revision": metadata["revision"],
            }
            try:
                _atomic_write(
                    snapshot,
                    yaml.safe_dump(
                        {"tables": metadata["tables"], "metrics": metadata["metrics"]},
                        allow_unicode=True,
                        sort_keys=False,
                    ),
                )
                state = self._state()
                state["builds"].insert(0, build)
                self._save_state(state)
                task = asyncio.create_task(self._run(build_id, snapshot))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
            except Exception:
                maintenance.finish_build(False)
                snapshot.unlink(missing_ok=True)
                raise
            return deepcopy(build)

    def _update_build(self, build_id: str, **updates) -> None:
        with self._lock:
            state = self._state()
            build = next(item for item in state["builds"] if item["id"] == build_id)
            build.update(**updates, updated_at=_now())
            if updates.get("status") == "done":
                state["built_revision"] = build["revision"]
            self._save_state(state)

    async def _run(self, build_id: str, snapshot: Path) -> None:
        success = False
        try:
            self._update_build(build_id, status="running", stage="校验真实表结构")

            def progress(stage: str, completed: int, total: int):
                self._update_build(
                    build_id,
                    stage=stage,
                    completed_stages=completed,
                    total_stages=total,
                )

            async with asyncio.timeout(1800):
                await self._execute_build(snapshot, progress)
            self._update_build(
                build_id, status="done", stage="构建完成", completed_stages=6
            )
            success = True
        except asyncio.CancelledError:
            self._record_failure(
                build_id,
                status="interrupted",
                stage="构建已中断",
                error="服务关闭中断了构建，请重新构建",
            )
        except Exception as exc:
            # 驱动异常可能含连接串、凭据和 SQL；仅公开异常类型，不持久化异常原文。
            self._record_failure(
                build_id,
                status="error",
                stage="构建失败",
                error=f"构建失败（{type(exc).__name__}），请检查数据源、字段及索引服务后重试",
            )
        finally:
            maintenance.finish_build(success)
            if self.on_complete is not None:
                try:
                    build = next(
                        item
                        for item in self.list_builds()["items"]
                        if item["id"] == build_id
                    )
                    self.on_complete(build)
                except Exception:
                    logger.error("知识库任务审计写入失败")
            with suppress(OSError):
                snapshot.unlink(missing_ok=True)

    def _record_failure(self, build_id: str, **updates) -> None:
        try:
            self._update_build(build_id, **updates)
        except Exception:
            # 连状态文件都不可写时保留旧的 running 记录供重启恢复，并观察任务异常。
            logger.error("知识库构建状态写入失败，已保持维护状态")

    async def _execute_build(self, config_path: Path, progress) -> None:
        # 复用 lifespan 创建的客户端；不启动子进程，避免嵌入式 Qdrant 文件锁冲突。
        from app.clients.embedding_client_manager import embedding_client_manager
        from app.clients.es_client_manager import es_client_manager
        from app.clients.mysql_client_manager import (
            dw_mysql_client_manager,
            meta_mysql_client_manager,
        )
        from app.clients.qdrant_client_manager import qdrant_client_manager
        from app.repositories.es.value_es_repository import ValueESRepository
        from app.repositories.mysql.dw.dw_mysql_repository import DWMySQLRepository
        from app.repositories.mysql.meta.meta_mysql_repository import (
            MetaMySQLRepository,
        )
        from app.repositories.qdrant.column_qdrant_repository import (
            ColumnQdrantRepository,
        )
        from app.repositories.qdrant.metric_qdrant_repository import (
            MetricQdrantRepository,
        )
        from app.services.meta_knowledge_service import MetaKnowledgeService

        if (
            qdrant_client_manager.client is None
            or embedding_client_manager.client is None
        ):
            raise RuntimeError("知识库客户端未初始化")
        async with (
            meta_mysql_client_manager.session_factory() as meta_session,
            dw_mysql_client_manager.session_factory() as dw_session,
        ):
            service = MetaKnowledgeService(
                MetaMySQLRepository(meta_session),
                DWMySQLRepository(dw_session),
                ColumnQdrantRepository(qdrant_client_manager.client),
                embedding_client_manager.client,
                ValueESRepository(es_client_manager.client),
                MetricQdrantRepository(qdrant_client_manager.client),
            )
            await service.build(config_path, full_replace=True, progress=progress)

    async def close(self) -> None:
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        with self._lock:
            state = self._state()
            interrupted = False
            for build in state["builds"]:
                if build["status"] in {"queued", "running"}:
                    build.update(
                        status="interrupted",
                        stage="构建已中断",
                        error="服务关闭中断了构建，请重新构建",
                        updated_at=_now(),
                    )
                    interrupted = True
            if interrupted:
                self._save_state(state)
                maintenance.finish_build(False)
