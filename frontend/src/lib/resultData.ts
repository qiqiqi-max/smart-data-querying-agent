/**
 * 查询结果数据工具
 * 负责结果行归一化、列类型识别、图表方案推断和 CSV 生成，供表格、图表和导出共用。
 * 本文件不依赖 DOM 和其他模块，便于单独验证。
 */
export type Row = Record<string, unknown>;
export type ColumnKind = "number" | "temporal" | "text";
export type ChartType = "bar" | "line";

export type ColumnInfo = {
  name: string;
  kind: ColumnKind;
};

export type ChartPlan = {
  dimension: string;
  // 多维度时的分组列：折线图按它拆成多条线，柱状图拼进标签
  series?: string;
  metrics: string[];
  defaultType: ChartType;
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type ChartSeries = {
  name: string;
  points: ChartPoint[];
};

export const MAX_BARS = 12;
export const MAX_LINE_SERIES = 6;

export function normalizeRows(data: unknown): Row[] {
  if (Array.isArray(data)) {
    return data.map((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Row)
        : { 序号: index + 1, 值: item },
    );
  }
  if (data && typeof data === "object") {
    return [data as Row];
  }
  if (data === null || data === undefined || data === "") {
    return [];
  }
  return [{ 值: data }];
}

export function getColumns(rows: Row[]): string[] {
  const keys = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
  return Array.from(keys);
}

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

// MySQL 的 SUM(INT) 等返回 DECIMAL，经后端序列化后是字符串，这里一并按数值处理
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!NUMERIC_TEXT.test(text)) return null;
  // 前导零的整数（如 "007"）更像编码，不当作数值
  if (/^[+-]?0\d/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const ID_NAME = /((^|_)(id|key|code|no)$|编号$|编码$|代码$|^序号$|^id$)/i;
const TIME_NAME_EN = /(^|_)(date|dt|time|day|month|year|quarter|week|ym)(_(id|key))?$/i;
const TIME_NAME_EN_PREFIX = /^(date|month|year|quarter|week|day)(_|$)/i;
const TIME_NAME_ZH = /(日期|时间|月份|年份|季度|年月|周次)$|^(月|年|日|周|天)$/;

const DATE_TEXT = [
  /^\d{4}-\d{1,2}(-\d{1,2})?([ T][\d:.]+Z?)?$/,
  /^\d{4}\/\d{1,2}(\/\d{1,2})?$/,
  /^\d{4}年\d{1,2}月(\d{1,2}日)?$/,
  /^(\d{4}-?)?Q[1-4]$/i,
];

function isDateText(value: unknown) {
  return typeof value === "string" && DATE_TEXT.some((pattern) => pattern.test(value.trim()));
}

function isTimeName(name: string) {
  return TIME_NAME_EN.test(name) || TIME_NAME_EN_PREFIX.test(name) || TIME_NAME_ZH.test(name);
}

function present(values: unknown[]) {
  return values.filter((value) => value !== null && value !== undefined && value !== "");
}

export function classifyColumn(name: string, values: unknown[]): ColumnKind {
  const filled = present(values);
  if (filled.length === 0) return "text";

  if (filled.every(isDateText)) return "temporal";

  const numbers = filled.map(parseNumber);
  const allNumeric = numbers.every((value) => value !== null);

  // 列名像时间、取值是整数（如 20250301、202503、月份 1~12）时按时间维度处理
  if (isTimeName(name) && (!allNumeric || numbers.every((value) => Number.isInteger(value)))) {
    return "temporal";
  }
  if (allNumeric && !ID_NAME.test(name)) return "number";
  return "text";
}

export function describeColumns(rows: Row[]): ColumnInfo[] {
  return getColumns(rows).map((name) => ({
    name,
    kind: classifyColumn(
      name,
      rows.map((row) => row[name]),
    ),
  }));
}

export function planChart(rows: Row[]): ChartPlan | null {
  if (rows.length < 2) return null;

  const columns = describeColumns(rows);
  const metrics = columns.filter((column) => column.kind === "number").map((column) => column.name);
  const temporal = columns.filter((column) => column.kind === "temporal").map((column) => column.name);
  const text = columns.filter((column) => column.kind === "text").map((column) => column.name);
  if (metrics.length === 0) return null;

  if (temporal.length > 0) {
    const series = text.find(
      (name) => new Set(rows.map((row) => String(row[name] ?? ""))).size <= MAX_LINE_SERIES,
    );
    return { dimension: temporal[0], series, metrics, defaultType: "line" };
  }
  if (text.length > 0) {
    return { dimension: text[0], series: text[1], metrics, defaultType: "bar" };
  }
  return null;
}

function labelOf(value: unknown) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

// 把数字片段补齐位数再比较，保证 "2025-3" 排在 "2025-12" 之前
function temporalKey(value: unknown) {
  return labelOf(value).replace(/\d+/g, (digits) => digits.padStart(8, "0"));
}

// 多条折线的横轴取所有标签的并集，并按时间顺序排列
export function sortTemporalLabels(labels: string[]) {
  return Array.from(new Set(labels)).sort((a, b) => {
    const [ka, kb] = [temporalKey(a), temporalKey(b)];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function barPoints(rows: Row[], plan: ChartPlan, metric: string) {
  const points: ChartPoint[] = [];
  rows.forEach((row) => {
    const value = parseNumber(row[metric]);
    if (value === null) return;
    const label = plan.series
      ? `${labelOf(row[plan.dimension])} · ${labelOf(row[plan.series])}`
      : labelOf(row[plan.dimension]);
    points.push({ label, value });
  });
  return { points: points.slice(0, MAX_BARS), omitted: Math.max(points.length - MAX_BARS, 0) };
}

export function lineSeries(rows: Row[], plan: ChartPlan, metric: string): ChartSeries[] {
  const groups = new Map<string, Row[]>();
  rows.forEach((row) => {
    const name = plan.series ? labelOf(row[plan.series]) : metric;
    groups.set(name, [...(groups.get(name) ?? []), row]);
  });

  return Array.from(groups, ([name, groupRows]) => ({
    name,
    points: groupRows
      .map((row) => ({ key: temporalKey(row[plan.dimension]), row }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ row }) => ({ label: labelOf(row[plan.dimension]), value: parseNumber(row[metric]) }))
      .filter((point): point is ChartPoint => point.value !== null),
  }));
}

// 一行且全是数值、不超过 4 列时，用指标卡展示，比一格表格更直观
export function kpiValues(rows: Row[]) {
  if (rows.length !== 1) return null;
  const columns = describeColumns(rows);
  if (columns.length === 0 || columns.length > 4) return null;
  if (columns.some((column) => column.kind !== "number")) return null;
  return columns.map((column) => ({
    label: column.name,
    value: parseNumber(rows[0][column.name]) as number,
  }));
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // 以 = + - @ 开头的文本会被表格软件当成公式执行，加单引号转义；负数保持原样
  if (/^[=+\-@\t\r]/.test(text) && parseNumber(text) === null) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// 带 UTF-8 BOM，Excel 直接打开中文不乱码
export function toCsv(rows: Row[], columns: string[] = getColumns(rows)) {
  const lines = [columns, ...rows.map((row) => columns.map((column) => row[column]))].map(
    (cells) => cells.map(csvCell).join(","),
  );
  return `\uFEFF${lines.join("\r\n")}`;
}

// 复制用制表符分隔，粘贴到 Excel 或飞书表格时自动分列
export function toTsv(rows: Row[], columns: string[] = getColumns(rows)) {
  const cell = (value: unknown) =>
    value === null || value === undefined
      ? ""
      : (typeof value === "object" ? JSON.stringify(value) : String(value)).replace(/[\t\r\n]+/g, " ");
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((cells) => cells.map(cell).join("\t"))
    .join("\n");
}

export function csvFileName(query: string, date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
  const title =
    query
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 20) || "查询结果";
  return `${title}-${stamp}.csv`;
}
