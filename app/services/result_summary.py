"""
查询结果摘要工具

集中处理结果行数和摘要文案，避免历史记录和流式返回各写一套规则。
"""


def count_result_rows(data: object) -> int:
    """按前端展示规则计算结果行数"""

    if isinstance(data, list):
        return len(data)
    if data is None or data == "":
        return 0
    return 1


def summarize_result(data: object, truncated: bool = False) -> str:
    """生成查询结果摘要，结果被行数上限截断时提示只返回了前 N 行"""

    if isinstance(data, list):
        if data and truncated:
            return f"查询完成，仅返回前 {len(data)} 行结果。"
        if data:
            return f"查询完成，共 {len(data)} 行结果。"
        return "查询完成，结果为空。"

    if isinstance(data, dict):
        return "查询完成，已返回结构化结果。"

    if data is None or data == "":
        return "查询完成，结果为空。"

    return f"查询完成：{data}"
