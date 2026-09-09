import asyncio

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
