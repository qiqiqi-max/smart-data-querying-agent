/**
 * 智能体执行轨迹组件
 * 默认折叠成一行摘要（状态、进度、耗时），展开后查看每个步骤的状态和耗时；失败或停止时自动展开
 */
import {
  Check,
  ChevronRight,
  Circle,
  Clock,
  LoaderCircle,
  Square,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/format";
import type { ChatMessage, StepState } from "../types/agent";

// 必须与后端节点写出的 step 名称一致，后端测试会校验这份列表
const stepOrder = [
  "抽取关键词",
  "召回字段信息",
  "召回指标信息",
  "召回字段取值",
  "合并召回信息",
  "过滤指标信息",
  "过滤表信息",
  "添加额外上下文",
  "生成SQL",
  "校验SQL",
  "校正SQL",
  "执行SQL",
];

type TraceStatus = "running" | "done" | "error" | "stopped";
type StepStatus = StepState["status"] | "pending" | "stopped";

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(Math.round(ms), 0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}分${Math.round((ms % 60_000) / 1000)}秒`;
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "running") {
    return (
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-amber-600" aria-hidden="true" />
      </span>
    );
  }
  if (status === "success") {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <Check className="h-2.5 w-2.5 stroke-[3]" aria-hidden="true" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-100 text-rose-600">
        <X className="h-2.5 w-2.5 stroke-[3]" aria-hidden="true" />
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-200 text-slate-500">
        <Square className="h-2 w-2 fill-current" aria-hidden="true" />
      </span>
    );
  }
  return <Circle className="h-2 w-2 text-slate-300" aria-hidden="true" />;
}

type StepRailProps = {
  steps?: StepState[];
  status?: ChatMessage["status"];
  startedAt: number;
  finishedAt?: number;
};

export function StepRail({ steps = [], status, startedAt, finishedAt }: StepRailProps) {
  const trace: TraceStatus = status === "streaming" ? "running" : (status ?? "done");
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 失败或停止时自动展开，方便直接看到卡在哪一步
  useEffect(() => {
    if (trace === "error" || trace === "stopped") setOpen(true);
  }, [trace]);

  useEffect(() => {
    if (trace !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [trace]);

  if (steps.length === 0) return null;

  const byName = new Map(steps.map((step) => [step.step, step]));
  const corrected = byName.has("校正SQL");
  const names = [
    ...stepOrder.filter((name) => corrected || name !== "校正SQL"),
    ...steps.map((step) => step.step).filter((name) => !stepOrder.includes(name)),
  ];
  const statusOf = (name: string): StepStatus => {
    const current = byName.get(name)?.status ?? "pending";
    return trace === "stopped" && current === "running" ? "stopped" : current;
  };

  const done = names.filter((name) => stepOrder.includes(name) && statusOf(name) === "success").length;
  const total = stepOrder.length - (corrected ? 0 : 1);
  const running = trace === "running"
    ? [...steps].reverse().find((step) => step.status === "running")
    : undefined;
  const failed = byName.has("SQL校验失败")
    ? byName.get("SQL校验失败")
    : [...steps].reverse().find((step) => step.status === "error");
  const elapsed = (finishedAt ?? (trace === "running" ? now : steps[steps.length - 1].updatedAt)) - startedAt;

  const title =
    trace === "running"
      ? `正在执行：${running?.step ?? "准备中"}`
      : trace === "error"
        ? `执行失败${failed ? `：${failed.step}` : ""}`
        : trace === "stopped"
          ? "已停止查询"
          : "执行完成";

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/80 transition-all duration-200">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition hover:bg-slate-100/80"
      >
        <StepIcon status={trace === "running" ? "running" : trace === "done" ? "success" : trace === "error" ? "error" : "stopped"} />
        <span className={cn("min-w-0 flex-1 truncate font-medium", trace === "error" ? "text-rose-600" : "text-slate-700")}>
          {title}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-mono text-slate-500 shadow-subtle ring-1 ring-slate-200/60">
            <Clock className="h-3 w-3 text-slate-400" />
            {formatDuration(elapsed)}
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            {done}/{total}
          </span>
          <ChevronRight className={cn("h-3.5 w-3.5 text-slate-400 transition-transform duration-200", open && "rotate-90")} aria-hidden="true" />
        </div>
      </button>

      {trace === "running" && (
        <div className="h-1 bg-slate-200/80">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-moss-600 transition-all duration-300"
            style={{ width: `${Math.max((done / total) * 100, 5)}%` }}
          />
        </div>
      )}

      {open && (
        <div className="border-t border-slate-200/80 bg-white/70 px-3.5 py-2.5">
          <ol className="relative space-y-1.5 border-l border-slate-200/90 pl-3 ml-1.5 my-1">
            {names.map((name) => {
              const step = byName.get(name);
              const stepStatus = statusOf(name);
              const duration = step && (stepStatus === "running" ? now : step.updatedAt) - step.startedAt;
              return (
                <li key={name} className="relative flex items-center justify-between text-xs py-0.5">
                  <span className="absolute -left-[18px] flex h-3 w-3 items-center justify-center bg-white rounded-full">
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      stepStatus === "success" ? "bg-emerald-500" :
                      stepStatus === "running" ? "bg-amber-500" :
                      stepStatus === "error" ? "bg-rose-500" : "bg-slate-300"
                    )} />
                  </span>

                  <span className={cn(
                    "text-[12px]",
                    stepStatus === "pending" ? "text-slate-400" :
                    stepStatus === "error" ? "font-medium text-rose-600" :
                    stepStatus === "running" ? "font-semibold text-amber-700" :
                    "font-medium text-slate-700"
                  )}>
                    {name}
                  </span>

                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    {stepStatus === "pending" ? "等待中" : duration ? formatDuration(duration) : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
