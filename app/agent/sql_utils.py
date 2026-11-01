"""SQL 文本处理工具。"""

import re

# 匹配整段被 ``` 或 ```sql 包裹的模型输出
_CODE_FENCE_PATTERN = re.compile(r"^```[A-Za-z]*\s*\n?(.*?)\n?\s*```$", re.DOTALL)


def clean_llm_sql(text: str) -> str:
    """去掉模型偶尔附带的 Markdown 代码块围栏，只保留 SQL 正文。"""
    sql = text.strip()
    match = _CODE_FENCE_PATTERN.match(sql)
    if match:
        sql = match.group(1).strip()
    return sql
