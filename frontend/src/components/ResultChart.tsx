/**
 * 查询结果图表
 * 根据列类型自动选择柱状图或折线图，支持切换图表类型和选择指标
 */
import { BarChart3, LineChart as LineChartIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/format";
import {
  barPoints,
  formatNumber,
  lineSeries,
  MAX_BARS,
  type ChartPlan,
  type ChartPoint,
  type ChartType,
  type Row,
} from "../lib/resultData";
import { LineChart } from "./LineChart";

function BarChart({ points }: { points: ChartPoint[] }) {
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 1);

  return (
    <div className="space-y-2">
      {points.map((point, index) => (
        <div
          key={`${point.label}-${index}`}
          className="grid grid-cols-[minmax(64px,140px)_minmax(0,1fr)_minmax(64px,auto)] items-center gap-3 text-sm"
          title={`${point.label}：${formatNumber(point.value)}`}
        >
          <div className="truncate text-slate-600">{point.label}</div>
          <div className="h-6 rounded bg-slate-100">
            <div
              className={cn("h-full rounded", point.value < 0 ? "bg-tomato/60" : "bg-moss/75")}
              style={{ width: `${Math.max((Math.abs(point.value) / max) * 100, 2)}%` }}
            />
          </div>
          <div className="text-right font-mono text-xs tabular-nums text-slate-700">
            {formatNumber(point.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TypeToggle({ value, onChange }: { value: ChartType; onChange: (value: ChartType) => void }) {
  const options = [
    { type: "line" as const, label: "折线", Icon: LineChartIcon },
    { type: "bar" as const, label: "柱状", Icon: BarChart3 },
  ];
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map(({ type, label, Icon }) => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition",
            value === type ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
          )}
          aria-pressed={value === type}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function ResultChart({ rows, plan }: { rows: Row[]; plan: ChartPlan }) {
  const [type, setType] = useState<ChartType>(plan.defaultType);
  const [metric, setMetric] = useState(plan.metrics[0]);
  // 类别维度没有先后顺序，折线没有意义，只提供柱状图
  const canSwitch = plan.defaultType === "line";
  const bars = type === "bar" ? barPoints(rows, plan, metric) : null;

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {plan.metrics.length > 1 ? (
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-moss/25"
            aria-label="选择指标"
          >
            {plan.metrics.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium text-slate-600">{metric}</span>
        )}
        {canSwitch && <TypeToggle value={type} onChange={setType} />}
      </div>

      {bars ? (
        <>
          <BarChart points={bars.points} />
          {bars.omitted > 0 && (
            <div className="mt-3 text-xs text-slate-400">
              仅显示前 {MAX_BARS} 项，其余 {bars.omitted} 项可在表格中查看。
            </div>
          )}
        </>
      ) : (
        <LineChart series={lineSeries(rows, plan, metric)} />
      )}
    </div>
  );
}
