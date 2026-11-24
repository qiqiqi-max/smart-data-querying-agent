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
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item, idx) => (
        <div
          key={item.label}
          className="rounded border border-slate-200 bg-slate-50/60 p-3 shadow-subtle"
        >
          <div className="flex items-center justify-between text-sm font-sans text-slate-600">
            <span>{item.label}</span>
            <span className="font-semibold text-slate-600">#0{idx + 1}</span>
          </div>
          <div className="mt-2 break-words text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
            {formatNumber(item.value)}
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
        <div className="flex max-w-full flex-wrap items-center gap-1" role="tablist" aria-label="结果视图">
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
                  "flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition sm:px-3",
                  isSelected
                    ? "bg-white text-brand-700 shadow-subtle border border-slate-200/80"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <Icon className={cn("hidden h-4 w-4 sm:block", isSelected ? "text-brand-600" : "text-slate-600")} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* 右侧动作工具 */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 border border-slate-200">
            {rows.length} 行结果
          </span>

          <div className="flex items-center rounded border border-slate-200 bg-white shadow-subtle">
            <button
              type="button"
              onClick={onCopy}
              disabled={tab === "sql" ? !sql : rows.length === 0}
              className="inline-flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              title="复制数据"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "已复制" : tab === "sql" ? "复制 SQL" : "复制数据"}</span>
            </button>

            <span className="h-3 w-[1px] bg-slate-200" />

            <button
              type="button"
              onClick={onExport}
              disabled={rows.length === 0}
              className="inline-flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              title="导出 CSV"
            >
              <Download className="h-3 w-3" />
              <span>导出 CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* 截断警告提示 */}
      {truncated && tab !== "sql" && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 font-sans text-sm text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>当前仅显示前 {rows.length} 行，请缩小查询范围以查看完整结果。</span>
        </div>
      )}

      {/* 视图内容容器 */}
      <div>
        {tab === "overview" && kpis && <KpiMetricsGrid items={kpis} />}
        {tab === "overview" && !kpis && plan && <ResultChart rows={rows} plan={plan} />}
        {tab === "table" &&
          (rows.length === 0 ? (
            <div className="p-8 text-center font-sans text-sm text-slate-600">
              查询已完成，没有符合条件的数据。
            </div>
          ) : (
            <ResultTable rows={rows} columns={columns} />
          ))}
        {tab === "sql" && <SqlBlock sql={sql} />}
      </div>
    </div>
  );
}
