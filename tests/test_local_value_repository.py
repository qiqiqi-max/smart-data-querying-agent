import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.entities.value_info import ValueInfo
from app.repositories.es.value_es_repository import ValueESRepository


def test_local_value_index_is_persistent_and_rebuildable(tmp_path):
    repository = ValueESRepository(None, tmp_path / "value_index.json")

    async def exercise():
        await repository.ensure_index()
        await repository.index(
            [
                ValueInfo("region.huadong", "华东", "dim_region.region_name"),
                ValueInfo("region.huanan", "华南", "dim_region.region_name"),
            ]
        )
        first_result = await repository.search("华东")
        assert [item.value for item in first_result] == ["华东"]

        # 本地索引是重建语义，旧值不应在下一次构建后继续残留。
        await repository.index(
            [ValueInfo("region.huabei", "华北", "dim_region.region_name")]
        )
        second_result = await repository.search("华东", score_threshold=0.1)
        assert second_result == []
        assert (await repository.search("华北"))[0].value == "华北"

    asyncio.run(exercise())


def test_unchanged_index_is_read_once_across_repository_instances(
    tmp_path, monkeypatch
):
    path = tmp_path / "value_index.json"
    repository = ValueESRepository(None, path)
    asyncio.run(repository.index([ValueInfo("east", "华东", "region")]))
    original_read = Path.read_text
    reads = []

    def read_text(file, *args, **kwargs):
        if file == path:
            reads.append(file)
        return original_read(file, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)
    for _ in range(4):
        result = asyncio.run(ValueESRepository(None, path).search("华东"))
        assert [item.id for item in result] == ["east"]
    assert len(reads) == 1


def test_external_same_size_replacement_invalidates_cache(tmp_path):
    path = tmp_path / "value_index.json"
    repository = ValueESRepository(None, path)
    asyncio.run(repository.index([ValueInfo("east", "华东", "region")]))
    assert asyncio.run(repository.search("华东"))[0].value == "华东"
    before = path.stat()
    replacement = tmp_path / "replacement.json"
    replacement.write_text(
        path.read_text(encoding="utf-8").replace("华东", "华南"), encoding="utf-8"
    )
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    replacement.replace(path)
    assert path.stat().st_size == before.st_size
    assert asyncio.run(repository.search("华东")) == []
    assert asyncio.run(repository.search("华南"))[0].value == "华南"


@pytest.mark.parametrize("content", ["{broken", "{}"])
def test_corrupted_index_does_not_return_cached_results(tmp_path, content):
    path = tmp_path / "value_index.json"
    repository = ValueESRepository(None, path)
    asyncio.run(repository.index([ValueInfo("east", "华东", "region")]))
    assert asyncio.run(repository.search("华东"))
    path.write_text(content, encoding="utf-8")
    with pytest.raises(RuntimeError, match="本地字段值索引"):
        asyncio.run(repository.search("华东"))


def test_concurrent_searches_share_one_file_read(tmp_path, monkeypatch):
    path = tmp_path / "value_index.json"
    asyncio.run(
        ValueESRepository(None, path).index([ValueInfo("east", "华东", "region")])
    )
    original_read = Path.read_text
    reads = []

    def read_text(file, *args, **kwargs):
        if file == path:
            reads.append(file)
        return original_read(file, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(
            pool.map(
                lambda _: ValueESRepository(None, path)._search_local("华东", 0.6, 20),
                range(8),
            )
        )
    assert all([item.value for item in result] == ["华东"] for result in results)
    assert len(reads) == 1


def test_tokenization_is_reused_for_repeated_keywords(tmp_path, monkeypatch):
    from app.repositories.es import value_es_repository as module

    path = tmp_path / "value_index.json"
    path.write_text(
        json.dumps([{"id": "c", "value": "cache alpha", "column_id": "c"}]),
        encoding="utf-8",
    )
    original_cut = module.jieba.lcut
    calls = []

    def cut(text):
        calls.append(text)
        return original_cut(text)

    monkeypatch.setattr(module.jieba, "lcut", cut)
    repository = ValueESRepository(None, path)
    for _ in range(3):
        asyncio.run(repository.search("cache beta", score_threshold=0.0))
    assert calls.count("cachealpha") == 1
    assert calls.count("cachebeta") == 1


def test_timestamp_preserving_rewrite_is_revalidated_within_one_second(
    tmp_path, monkeypatch
):
    import time

    clock = [100.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    path = tmp_path / "value_index.json"
    repository = ValueESRepository(None, path)
    repository._index_local([ValueInfo("region", "east", "region")])
    assert repository._search_local("east", 0.6, 20)[0].value == "east"
    before = path.stat()
    path.write_text(
        path.read_text(encoding="utf-8").replace("east", "west"), encoding="utf-8"
    )
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    clock[0] += 1.01
    assert repository._search_local("east", 0.6, 20) == []
    assert repository._search_local("west", 0.6, 20)[0].value == "west"
