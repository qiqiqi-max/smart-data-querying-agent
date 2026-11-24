"""Persisted configuration drafts and bounded connectivity checks."""

import asyncio
import hashlib
import json
import os
import time
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
from threading import RLock
from uuid import uuid4

from fastapi import HTTPException
from langchain_core.messages import HumanMessage
from pydantic import ValidationError
from sqlalchemy import URL, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.schemas.admin_settings_schema import (
    DatabaseSettingsInput,
    ModelSettingsInput,
    SettingsUpdate,
)
from app.conf.app_config import AppConfig


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with open(temporary, "x", encoding="utf-8") as handle:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class AdminSettingsService:
    def __init__(self, path: Path, config: AppConfig):
        self.path = path
        self.effective = {
            name: asdict(getattr(config, name)) for name in ("db_meta", "db_dw", "llm")
        }
        self._lock = RLock()

    def _load_saved(self) -> dict:
        result = deepcopy(self.effective)
        if not self.path.exists():
            return result
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or set(payload) - set(result):
                raise ValueError()
            for name in result:
                result[name].update(payload.get(name, {}))
            self._validate(result)
        except ValueError, OSError, TypeError, ValidationError:
            raise HTTPException(
                503, "后台保存的配置无法读取，请检查本地配置文件。"
            ) from None
        return result

    @staticmethod
    def _validate(values):
        for name in ("db_meta", "db_dw"):
            DatabaseSettingsInput.model_validate(values[name])
        ModelSettingsInput.model_validate(values["llm"])

    @staticmethod
    def _revision(values) -> str:
        return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()

    @staticmethod
    def _public(values):
        result = deepcopy(values)
        for name in ("db_meta", "db_dw"):
            result[name]["password_set"] = bool(result[name].pop("password", ""))
        result["llm"]["api_key_set"] = bool(result["llm"].pop("api_key", ""))
        return result

    def read(self) -> dict:
        with self._lock:
            saved = self._load_saved()
            return {
                "revision": self._revision(saved),
                "restart_required": saved != self.effective,
                "effective": self._public(self.effective),
                "saved": self._public(saved),
            }

    def save(self, payload: SettingsUpdate) -> dict:
        with self._lock:
            saved = self._load_saved()
            if payload.revision != self._revision(saved):
                raise HTTPException(409, "配置已被其他窗口修改，请刷新后重试。")
            for name in ("db_meta", "db_dw", "llm"):
                self._connection_values(name, getattr(payload, name))
                for key, value in getattr(payload, name).model_dump().items():
                    if key in {"password", "api_key"}:
                        if value is None or not value.get_secret_value():
                            continue
                        value = value.get_secret_value()
                    saved[name][key] = value
            self._validate(saved)
            atomic_json(self.path, saved)
            return self.read()

    def _connection_values(self, name: str, payload) -> dict:
        saved = self._load_saved()[name]
        values = payload.model_dump()
        secret = "api_key" if name == "llm" else "password"
        entry = values.get(secret)
        if not entry or not entry.get_secret_value():
            # A blank key can only be reused against the endpoint the administrator saved.
            target_keys = ("base_url",) if name == "llm" else ("host", "port", "user")
            if any(values[k] != saved[k] for k in target_keys):
                raise HTTPException(
                    422,
                    "更换服务地址或账号时请填写凭据，避免将已保存的密钥发送到其他服务。",
                )
            values[secret] = saved.get(secret, "")
        else:
            values[secret] = entry.get_secret_value()
        return values

    async def test_database(self, name: str, payload: DatabaseSettingsInput):
        values = self._connection_values("db_" + name, payload)
        started = time.monotonic()
        engine = create_async_engine(
            URL.create(
                "mysql+aiomysql",
                username=values["user"],
                password=values["password"],
                host=values["host"],
                port=values["port"],
                database=values["database"],
                query={"charset": "utf8mb4"},
            ),
            connect_args={"connect_timeout": 5},
            pool_pre_ping=True,
        )
        try:
            async with asyncio.timeout(8):
                async with engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
            ok, message = True, "连接成功，数据库可访问。"
        except Exception:
            ok, message = False, "连接失败，请检查地址、账号权限、密码和数据库名称。"
        finally:
            await engine.dispose()
        return {
            "ok": ok,
            "message": message,
            "latency_ms": round((time.monotonic() - started) * 1000),
        }

    async def test_model(self, payload: ModelSettingsInput):
        from app.agent.llm import RequestsChatModel

        values = self._connection_values("llm", payload)
        if not values["base_url"] or not values["api_key"]:
            raise HTTPException(422, "请填写模型地址与 API 密钥。")
        started = time.monotonic()
        try:
            model = RequestsChatModel(**values, timeout=10)
            async with asyncio.timeout(12):
                response = await model.ainvoke(
                    [HumanMessage(content="Reply with OK only.")]
                )
            ok = bool(response.content)
            message = "模型调用成功。" if ok else "服务返回了空响应。"
        except Exception:
            ok, message = (
                False,
                "模型调用失败，请检查地址、模型名称、API 密钥和服务可用性。",
            )
        return {
            "ok": ok,
            "message": message,
            "latency_ms": round((time.monotonic() - started) * 1000),
        }
