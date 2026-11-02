/**
 * 查询结果大屏面板 (B2B BI 风格)
 * 工业级紧凑 Tab 切换、指标卡矩阵、报表与 SQL 视图
 */
import {
  AlertCircle,
  BarChart2,
  Check,
  Code,
  Copy,
  Download,
  FileSpreadsheet,
  Layers,
  Table as TableIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { downloadText, useCopy } from "../lib/browser";
import { cn } from "../lib/format";
import {
  csvFileName,
  describeColumns,
  formatNumber,
  kpiValues,
  normalizeRows,
  planChart,
  toCsv,
  toTsv,
} from "../lib/resultData";
import { ResultChart } from "./ResultChart";
import { ResultTable } from "./ResultTable";
import { SqlBlock } from "./SqlBlock";

type Tab = "overview" | "table" | "sql";

type ResultPanelProps = {
  data: unknown;
  truncated?: boolean;
  sql?: string;
  query?: string;
};

function KpiMetricsGrid({ items }: { items: Array<{ label: string; value: number }> }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3">
      {items.map((item, idx) => (
        <div
          key={item.label}
          className="rounded border border-slate-200 bg-slate-50/60 p-3 shadow-subtle"
        >
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>{item.label}</span>
            <span className="font-semibold text-slate-400">#0{idx + 1}</span>
          </div>
          <div className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
            {formatNumber(item.value)}
          </div>
          <div className="mt-1 text-[10px] text-slate-400 font-mono">
            AGG_TYPE: SUM / AVG
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultPanel({ data, truncated = false, sql, query = "" }: ResultPanelProps) {
  const { rows, columns, plan, kpis } = useMemo(() => {
    const rows = normalizeRows(data);
    return { rows, columns: describeColumns(rows), plan: planChart(rows), kpis: kpiValues(rows) };
  }, [data]);

  const overviewLabel = kpis ? "核心指标" : plan ? "趋势图表" : null;
  const [tab, setTab] = useState<Tab>(overviewLabel ? "overview" : "table");
  const { copied, copy } = useCopy();

  const tabs: Array<{ id: Tab; label: string; icon: typeof TableIcon }> = [
    ...(overviewLabel
      ? [{ id: "overview" as const, label: overviewLabel, icon: kpis ? Layers : BarChart2 }]
      : []),
    { id: "table", label: "数据报表", icon: FileSpreadsheet },
    { id: "sql", label: "执行 SQL", icon: Code },
  ];

  const onCopy = () =>
    void copy(tab === "sql" ? (sql ?? "") : toTsv(rows, columns.map((c) => c.name)));

  const onExport = () =>
    downloadText(
      csvFileName(query, new Date()),
      toCsv(rows, columns.map((column) => column.name)),
      "text/csv;charset=utf-8",
    );

  return (
    <div className="mt-3 overflow-hidden rounded border border-slate-200 bg-white shadow-subtle">
      {/* 报表工具条 (Toolbar) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-1.5">
        {/* Tab 选项卡 */}
        <div className="flex items-center space-x-1" role="tablist">
          {tabs.map((item) => {
            const isSelected = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition",
                  isSelected
                    ? "bg-white text-brand-700 shadow-subtle border border-slate-200/80"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", isSelected ? "text-brand-600" : "text-slate-400")} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* 右侧动作工具 */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 border border-slate-200">
            TOTAL: {rows.length} ROWS
          </span>

          <div className="flex items-center rounded border border-slate-200 bg-white shadow-subtle">
            <button
              type="button"
              onClick={onCopy}
              disabled={tab === "sql" ? !sql : rows.length === 0}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
              title="复制数据"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "COPIED" : tab === "sql" ? "COPY_SQL" : "COPY_TSV"}</span>
            </button>

            <span className="h-3 w-[1px] bg-slate-200" />

            <button
              type="button"
              onClick={onExport}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
              title="导出 CSV"
            >
              <Download className="h-3 w-3" />
              <span>EXPORT_CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* 截断警告提示 */}
      {truncated && tab !== "sql" && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>[WARN] RESULT TRUNCATED: 当前结果已被安全截断至 {rows.length} 行，建议追加 WHERE 条件下钻。</span>
        </div>
      )}

      {/* 视图内容容器 */}
      <div>
        {tab === "overview" && kpis && <KpiMetricsGrid items={kpis} />}
        {tab === "overview" && !kpis && plan && <ResultChart rows={rows} plan={plan} />}
        {tab === "table" &&
          (rows.length === 0 ? (
            <div className="p-8 text-center font-mono text-xs text-slate-400">
              [EMPTY_SET] 查询执行成功，但返回数据集为空。
            </div>
          ) : (
            <ResultTable rows={rows} columns={columns} />
          ))}
        {tab === "sql" && <SqlBlock sql={sql} />}
      </div>
    </div>
  );
}
