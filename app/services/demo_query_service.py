"""
本地演示问数服务

当 LLM / Qdrant / Elasticsearch / Embedding 服务不可用时，
这里提供一条完全本地、可重复执行的替代链路。
它保留和正式链路一致的进度事件和结果落库行为，
但 SQL 生成由规则驱动，避免项目在演示时卡在外部依赖上。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import AsyncIterator

from app.core.log import logger
from app.repositories.mysql.dw.dw_mysql_repository import DWMySQLRepository
from app.repositories.mysql.meta.query_history_repository import (
    QueryHistoryRepository,
)
from app.services.result_summary import summarize_result

DEMO_REFERENCE_DATE = date(2025, 3, 31)


@dataclass(frozen=True)
class DimensionSpec:
    table: str
    column: str
    label: str
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class MetricSpec:
    name: str
    label: str
    aliases: tuple[str, ...]
    expression: str


DIMENSIONS: tuple[DimensionSpec, ...] = (
    DimensionSpec(
        table="dim_region",
        column="region_name",
        label="地区",
        aliases=("地区", "区域", "大区", "华北", "华东", "华南", "华中", "西南"),
    ),
    DimensionSpec(
        table="dim_region",
        column="province",
        label="省份",
        aliases=(
            "省份",
            "省",
            "广东省",
            "浙江省",
            "四川省",
            "北京市",
            "上海市",
            "湖北省",
        ),
    ),
    DimensionSpec(
        table="dim_customer",
        column="gender",
        label="性别",
        aliases=("性别", "男", "女"),
    ),
    DimensionSpec(
        table="dim_customer",
        column="member_level",
        label="会员等级",
        aliases=("会员等级", "用户等级", "青铜", "白银", "黄金", "铂金"),
    ),
    DimensionSpec(
        table="dim_product",
        column="category",
        label="品类",
        aliases=(
            "品类",
            "类别",
            "分类",
            "手机数码",
            "家用电器",
            "鞋靴",
            "服饰",
            "食品饮料",
            "休闲零食",
        ),
    ),
    DimensionSpec(
        table="dim_product",
        column="brand",
        label="品牌",
        aliases=(
            "品牌",
            "苹果",
            "三星",
            "华为",
            "戴森",
            "美的",
            "耐克",
            "阿迪达斯",
            "优衣库",
            "李维斯",
            "雀巢",
            "蒙牛",
            "乐事",
            "奥利奥",
            "亚马逊",
            "Instant Pot",
        ),
    ),
    DimensionSpec(
        table="dim_product",
        column="product_name",
        label="商品",
        aliases=("商品", "产品", "iPhone 15 Pro", "Galaxy S24 Ultra", "Mate 60 Pro"),
    ),
    DimensionSpec(
        table="dim_date",
        column="quarter",
        label="季度",
        aliases=("季度", "Q1", "Q2", "Q3", "Q4"),
    ),
)

METRICS: tuple[MetricSpec, ...] = (
    MetricSpec(
        name="GMV",
        label="销售额",
        aliases=("销售额", "成交额", "成交总额", "订单总额", "GMV", "总额", "收入"),
        expression="ROUND(SUM(f.order_amount), 2)",
    ),
    MetricSpec(
        name="订单数",
        label="订单数",
        aliases=("订单数", "订单量", "单量", "成交单数"),
        expression="COUNT(*)",
    ),
    MetricSpec(
        name="销量",
        label="销量",
        aliases=("销量", "件数", "购买数量", "总件数"),
        expression="SUM(f.order_quantity)",
    ),
    MetricSpec(
        name="AOV",
        label="客单价",
        aliases=("客单价", "AOV", "平均订单金额", "平均单价"),
        expression="ROUND(SUM(f.order_amount) / NULLIF(COUNT(DISTINCT f.order_id), 0), 2)",
    ),
)

VALUE_FILTERS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "dim_region.region_name": (
        "r",
        "region_name",
        ("华北", "华东", "华南", "华中", "西南"),
    ),
    "dim_region.province": (
        "r",
        "province",
        ("广东省", "浙江省", "四川省", "北京市", "上海市", "湖北省"),
    ),
    "dim_customer.gender": ("c", "gender", ("男", "女")),
    "dim_customer.member_level": (
        "c",
        "member_level",
        ("青铜", "白银", "黄金", "铂金"),
    ),
    "dim_product.category": (
        "p",
        "category",
        ("手机数码", "家用电器", "鞋靴", "服饰", "食品饮料", "休闲零食"),
    ),
    "dim_product.brand": (
        "p",
        "brand",
        (
            "苹果",
            "三星",
            "华为",
            "戴森",
            "美的",
            "耐克",
            "阿迪达斯",
            "优衣库",
            "李维斯",
            "雀巢",
            "蒙牛",
            "乐事",
            "奥利奥",
            "亚马逊",
            "Instant Pot",
        ),
    ),
}

JOIN_SQL = {
    "dim_region": "JOIN dim_region r ON f.region_id = r.region_id",
    "dim_customer": "JOIN dim_customer c ON f.customer_id = c.customer_id",
    "dim_product": "JOIN dim_product p ON f.product_id = p.product_id",
    "dim_date": "JOIN dim_date d ON f.date_id = d.date_id",
}

GROUP_SQL = {
    "dim_region.region_name": ("r.region_name", "地区"),
    "dim_region.province": ("r.province", "省份"),
    "dim_customer.gender": ("c.gender", "性别"),
    "dim_customer.member_level": ("c.member_level", "会员等级"),
    "dim_product.category": ("p.category", "品类"),
    "dim_product.brand": ("p.brand", "品牌"),
    "dim_product.product_name": ("p.product_name", "商品"),
    "dim_date.quarter": ("d.quarter", "季度"),
}

DEMO_FILTER_PATTERNS: tuple[tuple[str, str, str, str], ...] = (
    ("dim_region.region_name", "华北", "r.region_name = '华北'", "地区"),
    ("dim_region.region_name", "华东", "r.region_name = '华东'", "地区"),
    ("dim_region.region_name", "华南", "r.region_name = '华南'", "地区"),
    ("dim_region.region_name", "华中", "r.region_name = '华中'", "地区"),
    ("dim_region.region_name", "西南", "r.region_name = '西南'", "地区"),
    ("dim_region.province", "广东省", "r.province = '广东省'", "省份"),
    ("dim_region.province", "浙江省", "r.province = '浙江省'", "省份"),
    ("dim_region.province", "四川省", "r.province = '四川省'", "省份"),
    ("dim_region.province", "北京市", "r.province = '北京市'", "省份"),
    ("dim_region.province", "上海市", "r.province = '上海市'", "省份"),
    ("dim_region.province", "湖北省", "r.province = '湖北省'", "省份"),
    ("dim_customer.gender", "男", "c.gender = '男'", "性别"),
    ("dim_customer.gender", "女", "c.gender = '女'", "性别"),
    ("dim_customer.member_level", "青铜", "c.member_level = '青铜'", "会员等级"),
    ("dim_customer.member_level", "白银", "c.member_level = '白银'", "会员等级"),
    ("dim_customer.member_level", "黄金", "c.member_level = '黄金'", "会员等级"),
    ("dim_customer.member_level", "铂金", "c.member_level = '铂金'", "会员等级"),
    ("dim_product.category", "手机数码", "p.category = '手机数码'", "品类"),
    ("dim_product.category", "家用电器", "p.category = '家用电器'", "品类"),
    ("dim_product.category", "鞋靴", "p.category = '鞋靴'", "品类"),
    ("dim_product.category", "服饰", "p.category = '服饰'", "品类"),
    ("dim_product.category", "食品饮料", "p.category = '食品饮料'", "品类"),
    ("dim_product.category", "休闲零食", "p.category = '休闲零食'", "品类"),
    ("dim_product.brand", "苹果", "p.brand = '苹果'", "品牌"),
    ("dim_product.brand", "华为", "p.brand = '华为'", "品牌"),
    ("dim_product.brand", "美的", "p.brand = '美的'", "品牌"),
    ("dim_product.brand", "耐克", "p.brand = '耐克'", "品牌"),
    ("dim_product.brand", "优衣库", "p.brand = '优衣库'", "品牌"),
    ("dim_product.brand", "雀巢", "p.brand = '雀巢'", "品牌"),
)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


def _contains(query: str, candidates: tuple[str, ...]) -> bool:
    normalized = _normalize(query)
    return any(_normalize(candidate) in normalized for candidate in candidates)


def _extract_keywords(query: str) -> list[str]:
    keywords: list[str] = []
    for dim in DIMENSIONS:
        if _contains(query, (dim.label, *dim.aliases)):
            keywords.append(dim.label)
    for metric in METRICS:
        if _contains(query, (metric.label, *metric.aliases)):
            keywords.append(metric.label)
    if not keywords:
        keywords.append(query)
    return list(dict.fromkeys([query, *keywords]))


def _pick_metric(query: str) -> MetricSpec:
    for metric in METRICS:
        if _contains(query, (metric.label, *metric.aliases)):
            return metric
    return METRICS[0]


def _pick_group_dimension(query: str) -> DimensionSpec | None:
    group_markers = (
        "各",
        "每个",
        "按",
        "排行",
        "top",
        "TOP",
        "最多",
        "前10",
        "前 10",
        "分布",
    )
    if not any(marker in query for marker in group_markers):
        return None

    for dim in DIMENSIONS:
        if _contains(query, (dim.label, *dim.aliases)):
            return dim
    return None


def _detect_joins(query: str, group_dim: DimensionSpec | None) -> list[str]:
    tables: list[str] = ["fact_order"]
    for dim in DIMENSIONS:
        if _contains(query, (dim.label, *dim.aliases)) or (
            group_dim is not None and dim.table == group_dim.table
        ):
            if dim.table not in tables:
                tables.append(dim.table)
    return tables


def _extract_filter_clauses(query: str) -> tuple[list[str], list[str]]:
    clauses: list[str] = []
    joins: list[str] = []
    for _column_key, trigger, clause, join_name in DEMO_FILTER_PATTERNS:
        if trigger in query and clause not in clauses:
            clauses.append(clause)
            joins.append(join_name)
    return clauses, joins


def _extract_date_clause(query: str) -> str | None:
    if "最近7天" in query:
        end = DEMO_REFERENCE_DATE
        start = end - timedelta(days=6)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {end:%Y%m%d}"
    if "最近30天" in query:
        end = DEMO_REFERENCE_DATE
        start = end - timedelta(days=29)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {end:%Y%m%d}"
    if "本月" in query:
        start = DEMO_REFERENCE_DATE.replace(day=1)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {DEMO_REFERENCE_DATE:%Y%m%d}"
    if "上月" in query:
        first_day = DEMO_REFERENCE_DATE.replace(day=1)
        end = first_day - timedelta(days=1)
        start = end.replace(day=1)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {end:%Y%m%d}"
    if "本季度" in query:
        quarter_start_month = ((DEMO_REFERENCE_DATE.month - 1) // 3) * 3 + 1
        start = DEMO_REFERENCE_DATE.replace(month=quarter_start_month, day=1)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {DEMO_REFERENCE_DATE:%Y%m%d}"
    if "今年" in query:
        start = DEMO_REFERENCE_DATE.replace(month=1, day=1)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {DEMO_REFERENCE_DATE:%Y%m%d}"

    month_match = re.search(r"(\d{4})年(\d{1,2})月", query)
    if month_match:
        year = int(month_match.group(1))
        month = int(month_match.group(2))
        start = date(year, month, 1)
        if month == 12:
            end = date(year, 12, 31)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {end:%Y%m%d}"

    year_match = re.search(r"(\d{4})年", query)
    if year_match:
        year = int(year_match.group(1))
        start = date(year, 1, 1)
        end = date(year, 12, 31)
        return f"f.date_id BETWEEN {start:%Y%m%d} AND {end:%Y%m%d}"

    explicit_day_match = re.search(r"(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})", query)
    if explicit_day_match:
        year = int(explicit_day_match.group(1))
        month = int(explicit_day_match.group(2))
        day = int(explicit_day_match.group(3))
        value = date(year, month, day)
        return f"f.date_id = {value:%Y%m%d}"

    return None


def _build_sql(query: str) -> tuple[str, str, list[str]]:
    metric = _pick_metric(query)
    group_dim = _pick_group_dimension(query)
    join_tables = _detect_joins(query, group_dim)
    filter_clauses, filter_joins = _extract_filter_clauses(query)
    join_names = list(dict.fromkeys([*join_tables, *filter_joins]))

    date_clause = _extract_date_clause(query)
    if date_clause:
        filter_clauses.append(date_clause)
        if "dim_date" not in join_names and (
            "季度" in query or "月" in query or "年" in query or "最近" in query
        ):
            join_names.append("dim_date")

    joins = [JOIN_SQL[name] for name in join_names if name in JOIN_SQL]

    if group_dim:
        group_expr, group_label = GROUP_SQL[f"{group_dim.table}.{group_dim.column}"]
        select_clause = f"SELECT {group_expr} AS `{group_label}`, {metric.expression} AS `{metric.label}`"
        group_clause = f"GROUP BY {group_expr}"
        order_clause = f"ORDER BY `{metric.label}` DESC"
        limit_clause = "LIMIT 10"
    else:
        select_clause = f"SELECT {metric.expression} AS `{metric.label}`"
        group_clause = ""
        order_clause = ""
        limit_clause = "LIMIT 1"

    sql_parts = [select_clause, "FROM fact_order f", *joins]
    if filter_clauses:
        sql_parts.append("WHERE " + " AND ".join(filter_clauses))
    if group_clause:
        sql_parts.append(group_clause)
    if order_clause:
        sql_parts.append(order_clause)
    sql_parts.append(limit_clause)

    sql = "\n".join(sql_parts)
    return sql, metric.label, _extract_keywords(query)


def _build_context_snapshot(query: str) -> dict:
    sql, metric_label, keywords = _build_sql(query)
    metric = _pick_metric(query)
    group_dim = _pick_group_dimension(query)
    table_names = _detect_joins(query, group_dim)

    table_infos = []
    for table_name in table_names:
        columns = []
        if table_name == "fact_order":
            columns = [
                {
                    "name": "order_id",
                    "type": "varchar",
                    "role": "primary_key",
                    "examples": [],
                    "description": "订单唯一标识",
                    "alias": ["订单ID"],
                },
                {
                    "name": "customer_id",
                    "type": "varchar",
                    "role": "foreign_key",
                    "examples": [],
                    "description": "客户外键",
                    "alias": ["客户ID"],
                },
                {
                    "name": "product_id",
                    "type": "varchar",
                    "role": "foreign_key",
                    "examples": [],
                    "description": "商品外键",
                    "alias": ["商品ID"],
                },
                {
                    "name": "date_id",
                    "type": "int",
                    "role": "foreign_key",
                    "examples": [],
                    "description": "日期外键",
                    "alias": ["日期"],
                },
                {
                    "name": "region_id",
                    "type": "varchar",
                    "role": "foreign_key",
                    "examples": [],
                    "description": "地区外键",
                    "alias": ["地区ID"],
                },
                {
                    "name": "order_quantity",
                    "type": "int",
                    "role": "measure",
                    "examples": [],
                    "description": "订单数量",
                    "alias": ["销量"],
                },
                {
                    "name": "order_amount",
                    "type": "float",
                    "role": "measure",
                    "examples": [],
                    "description": "订单金额",
                    "alias": ["销售额"],
                },
            ]
        elif table_name == "dim_region":
            columns = [
                {
                    "name": "region_id",
                    "type": "varchar",
                    "role": "primary_key",
                    "examples": [],
                    "description": "地区唯一标识",
                    "alias": ["地区ID"],
                },
                {
                    "name": "province",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "省份",
                    "alias": ["省份"],
                },
                {
                    "name": "region_name",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "大区",
                    "alias": ["地区"],
                },
                {
                    "name": "country",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "国家",
                    "alias": ["国家"],
                },
            ]
        elif table_name == "dim_customer":
            columns = [
                {
                    "name": "customer_id",
                    "type": "varchar",
                    "role": "primary_key",
                    "examples": [],
                    "description": "客户唯一标识",
                    "alias": ["客户ID"],
                },
                {
                    "name": "customer_name",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "客户名称",
                    "alias": ["客户名称"],
                },
                {
                    "name": "gender",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "客户性别",
                    "alias": ["性别"],
                },
                {
                    "name": "member_level",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "会员等级",
                    "alias": ["会员等级"],
                },
            ]
        elif table_name == "dim_product":
            columns = [
                {
                    "name": "product_id",
                    "type": "varchar",
                    "role": "primary_key",
                    "examples": [],
                    "description": "商品唯一标识",
                    "alias": ["商品ID"],
                },
                {
                    "name": "product_name",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "商品名称",
                    "alias": ["商品名称"],
                },
                {
                    "name": "category",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "商品品类",
                    "alias": ["品类"],
                },
                {
                    "name": "brand",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "商品品牌",
                    "alias": ["品牌"],
                },
            ]
        elif table_name == "dim_date":
            columns = [
                {
                    "name": "date_id",
                    "type": "int",
                    "role": "primary_key",
                    "examples": [],
                    "description": "日期唯一标识",
                    "alias": ["日期"],
                },
                {
                    "name": "year",
                    "type": "int",
                    "role": "dimension",
                    "examples": [],
                    "description": "年份",
                    "alias": ["年"],
                },
                {
                    "name": "quarter",
                    "type": "varchar",
                    "role": "dimension",
                    "examples": [],
                    "description": "季度",
                    "alias": ["季度"],
                },
                {
                    "name": "month",
                    "type": "int",
                    "role": "dimension",
                    "examples": [],
                    "description": "月份",
                    "alias": ["月"],
                },
                {
                    "name": "day",
                    "type": "int",
                    "role": "dimension",
                    "examples": [],
                    "description": "日",
                    "alias": ["日"],
                },
            ]
        table_infos.append(
            {
                "name": table_name,
                "role": "fact" if table_name == "fact_order" else "dim",
                "description": table_name,
                "columns": columns,
            }
        )

    metric_infos = [
        {
            "name": metric.name,
            "description": metric.name,
            "relevant_columns": [],
            "alias": [metric.label, *metric.aliases],
        }
    ]
    return {
        "keywords": keywords,
        "table_infos": table_infos,
        "metric_infos": metric_infos,
        "sql": sql,
        "metric_label": metric_label,
    }


async def run_demo_query(
    query: str,
    history_id: str,
    query_history_repository: QueryHistoryRepository,
    dw_mysql_repository: DWMySQLRepository,
) -> AsyncIterator[str]:
    """执行一条本地演示问数流程，并返回 SSE 文本片段。"""

    step = "演示模式"

    def writer(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"

    yield writer({"type": "progress", "step": step, "status": "running"})

    try:
        snapshot = _build_context_snapshot(query)
        keywords = snapshot["keywords"]
        sql = snapshot["sql"]

        for name in (
            "抽取关键词",
            "召回字段信息",
            "召回指标信息",
            "召回字段取值",
            "合并召回信息",
            "过滤表信息",
            "过滤指标信息",
            "添加额外上下文",
            "生成SQL",
        ):
            yield writer({"type": "progress", "step": name, "status": "running"})
            yield writer({"type": "progress", "step": name, "status": "success"})

        logger.info("演示模式关键词: {}", keywords)
        logger.info("演示模式SQL: {}", sql)

        yield writer({"type": "progress", "step": "校验SQL", "status": "running"})
        await dw_mysql_repository.validate(sql)
        yield writer({"type": "progress", "step": "校验SQL", "status": "success"})

        yield writer({"type": "progress", "step": "执行SQL", "status": "running"})
        result = await dw_mysql_repository.run(sql)
        yield writer({"type": "progress", "step": "执行SQL", "status": "success"})
        yield writer({"type": "result", "data": result})

        summary = summarize_result(result)
        await query_history_repository.mark_done(history_id, result, summary)
        yield writer({"type": "progress", "step": step, "status": "success"})
    except Exception as exc:
        message = f"演示模式执行失败: {exc}"
        logger.error(message)
        await query_history_repository.mark_error(history_id, message)
        yield writer({"type": "progress", "step": step, "status": "error"})
        yield writer({"type": "error", "message": message})
