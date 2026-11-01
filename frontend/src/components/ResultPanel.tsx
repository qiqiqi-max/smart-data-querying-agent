/**
 * 查询结果面板
 * 用标签页组织图表（或指标卡）、表格和 SQL，并提供复制和导出 CSV
 */
import { Check, Copy, Download, Info } from "lucide-react";
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
    <div className="grid gap-3 px-4 py-5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-slate-50 px-4 py-4">
          <div className="text-xs text-slate-500">{item.label}</div>
          <div className="mt-1 font-mono text-3xl font-semibold tabular-nums text-slate-900">
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

  const overviewLabel = kpis ? "指标" : plan ? "图表" : null;
  const [tab, setTab] = useState<Tab>(overviewLabel ? "overview" : "table");
  const { copied, copy } = useCopy();

  const tabs: Array<{ id: Tab; label: string }> = [
    ...(overviewLabel ? [{ id: "overview" as const, label: overviewLabel }] : []),
    { id: "table", label: "表格" },
    { id: "sql", label: "SQL" },
  ];

  const onCopy = () => void copy(tab === "sql" ? (sql ?? "") : toTsv(rows, columns.map((c) => c.name)));
  const onExport = () =>
    downloadText(
      csvFileName(query, new Date()),
      toCsv(rows, columns.map((column) => column.name)),
      "text/csv;charset=utf-8",
    );

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-2">
        <div className="flex" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-sm transition",
                tab === item.id
                  ? "border-moss font-medium text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 pr-1">
          <span className="mr-2 text-xs text-slate-400">{rows.length} 行</span>
          <button
            type="button"
            onClick={onCopy}
            disabled={tab === "sql" ? !sql : rows.length === 0}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-moss" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? "已复制" : tab === "sql" ? "复制 SQL" : "复制"}
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            导出 CSV
          </button>
        </div>
      </div>

      {truncated && tab !== "sql" && (
        <div className="flex items-center gap-2 border-b border-brass/20 bg-brass/10 px-4 py-2 text-xs text-brass">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          仅返回前 {rows.length} 行，可补充筛选条件或改为聚合查询。
        </div>
      )}

      {tab === "overview" && kpis && <KpiCards items={kpis} />}
      {tab === "overview" && !kpis && plan && <ResultChart rows={rows} plan={plan} />}
      {tab === "table" &&
        (rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">查询成功，但没有符合条件的数据。</div>
        ) : (
          <ResultTable rows={rows} columns={columns} />
        ))}
      {tab === "sql" && <SqlBlock sql={sql} />}
    </section>
  );
}
