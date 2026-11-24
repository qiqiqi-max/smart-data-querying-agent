"""
字段取值 ES 仓储

把字段真实取值组织成 Elasticsearch 全文索引，并提供索引创建 批量写入和关键词检索能力

Service 层负责决定哪些字段需要同步
Repository 只关心索引是否存在 ValueInfo 如何写进 ES 以及如何按关键词召回
"""

import asyncio
import json
import re
import time
from collections import OrderedDict
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path
from threading import RLock
from uuid import uuid4

import jieba
from elasticsearch import AsyncElasticsearch

from app.conf.app_config import app_config, resolve_project_path
from app.entities.value_info import ValueInfo


class ValueESRepository:
    """负责字段取值全文索引的创建 写入和基础检索"""

    index_name = "value_index"
    # 仓储按请求创建，缓存按进程共享；限制不同索引路径的数量，避免无限增长。
    _local_cache: OrderedDict[Path, tuple[tuple[int, ...], list[dict], float]] = (
        OrderedDict()
    )
    _local_cache_lock = RLock()
    _local_cache_capacity = 16
    # Windows 上原地改写后恢复 mtime 可能不改变 stat；最多一秒后强制复核内容。
    _local_cache_max_age = 1.0
    # value 字段使用 IK 分词，这样地区 会员等级 品类等中文值才能按全文方式检索
    index_mappings = {
        "dynamic": False,
        "properties": {
            "id": {"type": "keyword"},
            "value": {
                "type": "text",
                "analyzer": "ik_max_word",
                "search_analyzer": "ik_max_word",
            },
            "column_id": {"type": "keyword"},
        },
    }

    def __init__(
        self, client: AsyncElasticsearch | None, local_path: Path | None = None
    ):
        self.client = client
        self.local_mode = app_config.local_mode
        self.local_path = local_path or (
            resolve_project_path(app_config.local_data_dir) / "value_index.json"
        )
        if not self.local_mode and self.client is None:
            raise RuntimeError("Elasticsearch 客户端未初始化")

    async def ensure_index(self):
        """确保字段取值索引已经创建好"""
        if self.local_mode:
            await asyncio.to_thread(self._ensure_local_index)
            return

        if not await self.client.indices.exists(index=self.index_name):
            await self.client.indices.create(
                index=self.index_name, mappings=self.index_mappings
            )

    async def index(self, value_infos: list[ValueInfo], batch_size=20):
        """分批写入字段取值，避免一次 bulk 过大"""
        if self.local_mode:
            await asyncio.to_thread(self._index_local, value_infos)
            return

        if not value_infos:
            return

        for i in range(0, len(value_infos), batch_size):
            batch_value_infos = value_infos[i : i + batch_size]
            batch_operations = []
            for value_info in batch_value_infos:
                # 用 ValueInfo.id 作为文档 id，这样重复构建时会覆盖同一条值记录
                batch_operations.append(
                    {"index": {"_index": self.index_name, "_id": value_info.id}}
                )
                batch_operations.append(asdict(value_info))
            response = await self.client.bulk(operations=batch_operations)
            if response.get("errors"):
                raise RuntimeError("字段取值索引存在写入失败的记录")
        await self.client.indices.refresh(index=self.index_name)

    async def reset_index(self):
        """全量重建前移除旧值，包含配置中已删除的字段。"""
        if self.local_mode:
            await asyncio.to_thread(self._write_local, [])
            return
        if await self.client.indices.exists(index=self.index_name):
            await self.client.indices.delete(index=self.index_name)
        await self.ensure_index()

    async def search(
        self, keyword: str, score_threshold: float = 0.6, limit: int = 20
    ) -> list[ValueInfo]:
        """按关键词全文检索字段取值，并还原为 ValueInfo 实体"""

        if self.local_mode:
            return await asyncio.to_thread(
                self._search_local, keyword, score_threshold, limit
            )

        resp = await self.client.search(
            index=self.index_name,
            # value 字段启用了 IK 分词，match 查询可以处理中文短语和枚举值匹配
            query={"match": {"value": keyword}},
            size=limit,
            # 过滤掉相关度过低的命中，避免把明显无关的取值带入后续上下文
            min_score=score_threshold,
        )
        # ES 文档 _source 中保存的是 ValueInfo 的字段结构，业务层继续使用实体对象
        return [ValueInfo(**hit["_source"]) for hit in resp["hits"]["hits"]]

    def _ensure_local_index(self) -> None:
        """创建本地字段值索引文件。"""

        self.local_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.local_path.exists():
            self.local_path.write_text("[]", encoding="utf-8")

    def _read_local(self) -> list[dict]:
        path = self.local_path.resolve()
        with self._local_cache_lock:
            self._ensure_local_index()
            for _ in range(3):
                version = self._file_version(path)
                cached = self._local_cache.get(path)
                if (
                    cached is not None
                    and cached[0] == version
                    and time.monotonic() - cached[2] < self._local_cache_max_age
                ):
                    self._local_cache.move_to_end(path)
                    return cached[1]
                # 坏文件或读文件失败后不能继续使用旧快照。
                self._local_cache.pop(path, None)
                try:
                    records = json.loads(path.read_text(encoding="utf-8"))
                except json.JSONDecodeError as exc:
                    raise RuntimeError(f"本地字段值索引损坏：{path}") from exc
                if not isinstance(records, list):
                    raise RuntimeError(f"本地字段值索引格式错误：{path}")
                if self._file_version(path) != version:
                    continue
                records = [record for record in records if isinstance(record, dict)]
                self._local_cache[path] = (version, records, time.monotonic())
                while len(self._local_cache) > self._local_cache_capacity:
                    self._local_cache.popitem(last=False)
                return records
            raise RuntimeError(f"本地字段值索引正在更新，请重试：{path}")

    @staticmethod
    def _file_version(path: Path) -> tuple[int, ...]:
        stat = path.stat()
        return stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_ino

    def _write_local(self, records: list[dict]) -> None:
        with self._local_cache_lock:
            self.local_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = self.local_path.with_name(
                f"{self.local_path.name}.{uuid4().hex}.tmp"
            )
            try:
                temporary_path.write_text(
                    json.dumps(records, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                temporary_path.replace(self.local_path)
                self._local_cache.pop(self.local_path.resolve(), None)
            finally:
                temporary_path.unlink(missing_ok=True)

    def _index_local(self, value_infos: list[ValueInfo]) -> None:
        """把真实 DW 字段值写入本地持久化索引。"""

        records_by_id = {}
        for value_info in value_infos:
            records_by_id[str(value_info.id)] = {
                "id": str(value_info.id),
                "value": str(value_info.value),
                "column_id": str(value_info.column_id),
            }
        records = [records_by_id[key] for key in sorted(records_by_id)]
        self._write_local(records)

    @staticmethod
    def _normalize(value: object) -> str:
        return re.sub(r"\s+", "", str(value).casefold())

    @staticmethod
    @lru_cache(maxsize=4096)
    def _tokens(normalized: str) -> frozenset[str]:
        return frozenset(token for token in jieba.lcut(normalized) if token.strip())

    @classmethod
    def _score(cls, keyword: str, value: object) -> float:
        normalized_keyword = cls._normalize(keyword)
        normalized_value = cls._normalize(value)
        if not normalized_keyword or not normalized_value:
            return 0.0
        if normalized_keyword == normalized_value:
            return 1.0
        if (
            normalized_keyword in normalized_value
            or normalized_value in normalized_keyword
        ):
            return 0.95

        keyword_tokens = cls._tokens(normalized_keyword)
        value_tokens = cls._tokens(normalized_value)
        if not keyword_tokens or not value_tokens:
            return 0.0
        overlap = len(keyword_tokens & value_tokens)
        return overlap / len(keyword_tokens | value_tokens)

    def _search_local(
        self, keyword: str, score_threshold: float, limit: int
    ) -> list[ValueInfo]:
        scored_records = []
        for record in self._read_local():
            score = self._score(keyword, record.get("value", ""))
            if score >= score_threshold:
                scored_records.append((score, str(record.get("id", "")), record))

        scored_records.sort(key=lambda item: (-item[0], item[1]))
        return [
            ValueInfo(
                id=str(record.get("id", "")),
                value=str(record.get("value", "")),
                column_id=str(record.get("column_id", "")),
            )
            for _, _, record in scored_records[:limit]
        ]
