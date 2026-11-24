"""
表信息过滤节点

负责在合并后的候选表结构中筛选出当前问题真正需要的表和字段
这里让大模型只返回“保留哪些表和字段”的选择结果，真正的结构裁剪仍由程序完成
"""

import yaml
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import PromptTemplate
from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.llm import llm
from app.agent.state import DataAgentState, TableInfoState
from app.core.log import logger
from app.prompt.prompt_loader import load_prompt


async def filter_table(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    """根据用户问题裁剪候选表结构上下文"""

    writer = runtime.stream_writer
    step = "过滤表信息"
    writer({"type": "progress", "step": step, "status": "running"})

    try:
        query = state["query"]
        table_infos: list[TableInfoState] = state["table_infos"]

        # table_infos 是嵌套结构，转成 YAML 后更适合放进提示词，也保留中文字段说明
        prompt = PromptTemplate(
            template=load_prompt("filter_table_info"),
            input_variables=["query", "table_infos"],
        )
        # filter_table_info prompt 要求模型只输出 JSON 对象：表名 -> 字段名列表
        output_parser = JsonOutputParser()
        # LCEL 管道：填充提示词 -> 调用模型 -> 解析 JSON
        chain = prompt | llm | output_parser

        result = await chain.ainvoke(
            {
                "query": query,
                "table_infos": yaml.dump(
                    table_infos, allow_unicode=True, sort_keys=False
                ),
            }
        )
        # 模型只负责选择，程序根据选择结果从原始 TableInfoState 中裁剪，避免模型重写复杂结构出错
        filtered_table_infos: list[TableInfoState] = []
        required = set((state.get("assessment") or {}).get("required_columns", []))
        required_tables = set(
            (state.get("assessment") or {}).get("required_tables", [])
        )
        for table_info in table_infos:
            selected = result.get(table_info["name"], [])
            columns = [
                column
                for column in table_info["columns"]
                if column["name"] in selected
                or f"{table_info['name']}.{column['name']}" in required
            ]
            if not columns and table_info["name"] in required_tables:
                columns = table_info["columns"]
            if columns or table_info["name"] in required_tables:
                table_info["columns"] = columns
                filtered_table_infos.append(table_info)

        logger.info(
            f"过滤后的表信息：{[filtered_table_info['name'] for filtered_table_info in filtered_table_infos]}"
        )
        writer({"type": "progress", "step": step, "status": "success"})
        return {"table_infos": filtered_table_infos}

    except Exception as e:
        logger.error(f"{step} failed: {e}")
        writer({"type": "progress", "step": step, "status": "error"})
        raise
