/**
 * 查询结果面板
 * 用现代 Segmented 标签页组织指标卡、图表、表格和 SQL，并提供一键复制与导出 CSV
 */
import {
  AlertCircle,
  BarChart3,
  Check,
  Code2,
  Copy,
  Download,
  Sparkles,
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

function KpiCards({ items }: { items: Array<{ label: string; value: number }> }) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, idx) => (
        <div
          key={item.label}
          className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/70 p-4 shadow-subtle transition-all duration-200 hover:shadow-card hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">{item.label}</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-moss-50 text-[10px] font-bold text-moss-700">
              #{idx + 1}
            </span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
            {formatNumber(item.value)}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
            <span>度量指标总览</span>
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

  const overviewLabel = kpis ? "核心指标" : plan ? "数据图表" : null;
  const [tab, setTab] = useState<Tab>(overviewLabel ? "overview" : "table");
  const { copied, copy } = useCopy();

  const tabs: Array<{ id: Tab; label: string; icon: typeof TableIcon }> = [
    ...(overviewLabel
      ? [{ id: "overview" as const, label: overviewLabel, icon: kpis ? Sparkles : BarChart3 }]
      : []),
    { id: "table", label: "明细表格", icon: TableIcon },
    { id: "sql", label: "执行 SQL", icon: Code2 },
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
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-card">
      {/* 顶部现代化 Segmented 栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/60 px-3 py-2.5 sm:px-4">
        {/* 胶囊选项卡 */}
        <div className="flex items-center rounded-xl bg-slate-200/60 p-1" role="tablist">
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
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150",
                  isSelected
                    ? "bg-white text-slate-900 shadow-sm font-semibold"
                    : "text-slate-500 hover:text-slate-800",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", isSelected ? "text-moss-700" : "text-slate-400")} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* 右侧动作区 */}
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-500 shadow-subtle ring-1 ring-slate-200/60">
            {rows.length} 条记录
          </span>

          <div className="flex items-center rounded-lg border border-slate-200/80 bg-white p-0.5 shadow-subtle">
            <button
              type="button"
              onClick={onCopy}
              disabled={tab === "sql" ? !sql : rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              title={tab === "sql" ? "复制完整 SQL" : "复制表格数据 (TSV)"}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              )}
              <span>{copied ? "已复制" : tab === "sql" ? "复制 SQL" : "复制数据"}</span>
            </button>

            <span className="h-3.5 w-[1px] bg-slate-200" />

            <button
              type="button"
              onClick={onExport}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              title="导出为 CSV 文件"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span>导出 CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* 截断警告提示 */}
      {truncated && tab !== "sql" && (
        <div className="flex items-center gap-2 border-b border-amber-200/60 bg-amber-50/70 px-4 py-2 text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>查询结果已达到数仓安全阈值，当前仅展示前 {rows.length} 行，建议补充更精准的时间或范围筛选。</span>
        </div>
      )}

      {/* 视图内容切换区 */}
      <div className="relative">
        {tab === "overview" && kpis && <KpiCards items={kpis} />}
        {tab === "overview" && !kpis && plan && <ResultChart rows={rows} plan={plan} />}
        {tab === "table" &&
          (rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-sm text-slate-400">
              <TableIcon className="h-8 w-8 text-slate-200 mb-2" />
              <p>查询已成功执行，但未匹配到有效行数据。</p>
            </div>
          ) : (
            <ResultTable rows={rows} columns={columns} />
          ))}
        {tab === "sql" && <SqlBlock sql={sql} />}
      </div>
    </section>
  );
}
