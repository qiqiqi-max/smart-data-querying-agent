from datetime import datetime
from decimal import Decimal

from app.repositories.mysql.meta.query_history_repository import QueryHistoryRepository
from app.services.result_summary import count_result_rows, summarize_result


def test_summarize_list_result():
    data = [{"region": "华东"}, {"region": "华南"}]

    assert count_result_rows(data) == 2
    assert summarize_result(data) == "查询完成，共 2 行结果。"


def test_summarize_truncated_result():
    data = [{"n": i} for i in range(1000)]

    assert count_result_rows(data) == 1000
    assert summarize_result(data, truncated=True) == "查询完成，仅返回前 1000 行结果。"
    assert summarize_result(data, truncated=False) == "查询完成，共 1000 行结果。"


def test_summarize_empty_result():
    assert count_result_rows([]) == 0
    assert summarize_result([]) == "查询完成，结果为空。"


def test_summarize_object_result():
    assert count_result_rows({"total": 100}) == 1
    assert summarize_result({"total": 100}) == "查询完成，已返回结构化结果。"


def test_query_history_result_is_json_safe():
    result = QueryHistoryRepository._json_safe(
        [{"销量": Decimal("12"), "日期": datetime(2025, 3, 1)}]
    )
    assert result == [{"销量": 12.0, "日期": "2025-03-01T00:00:00"}]
