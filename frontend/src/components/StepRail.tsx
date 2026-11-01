/**
 * 智能体执行轨迹组件
 * 默认折叠成一行摘要（状态、进度、耗时），展开后查看每个步骤的状态和耗时；失败或停止时自动展开
 */
import { Check, ChevronRight, Circle, LoaderCircle, Square, X } from "lucide-react";
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
  if (status === "running") return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brass" aria-hidden="true" />;
  if (status === "success") return <Check className="h-3.5 w-3.5 text-moss" aria-hidden="true" />;
  if (status === "error") return <X className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />;
  if (status === "stopped") return <Square className="h-3 w-3 text-slate-400" aria-hidden="true" />;
  return <Circle className="h-3 w-3 text-slate-300" aria-hidden="true" />;
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
  // 只统计标准流程里的步骤，演示模式等额外步骤不计入进度
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
          ? "已停止"
          : "执行完成";

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-100/70"
      >
        <StepIcon status={trace === "running" ? "running" : trace === "done" ? "success" : trace === "error" ? "error" : "stopped"} />
        <span className={cn("min-w-0 flex-1 truncate", trace === "error" ? "text-tomato" : "text-slate-700")}>{title}</span>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">
          {done}/{total} 步 · {formatDuration(elapsed)}
        </span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-90")} aria-hidden="true" />
      </button>

      {trace === "running" && (
        <div className="h-0.5 bg-slate-200">
          <div className="h-full bg-moss transition-all" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}

      {open && (
        <ol className="border-t border-slate-200 px-3 py-2">
          {names.map((name) => {
            const step = byName.get(name);
            const stepStatus = statusOf(name);
            const duration = step && (stepStatus === "running" ? now : step.updatedAt) - step.startedAt;
            return (
              <li key={name} className="flex items-center gap-2 py-1 text-[13px]">
                <StepIcon status={stepStatus} />
                <span className={cn("flex-1", stepStatus === "pending" ? "text-slate-400" : stepStatus === "error" ? "text-tomato" : "text-slate-700")}>
                  {name}
                </span>
                <span className="text-xs tabular-nums text-slate-400">
                  {stepStatus === "pending" ? "" : duration ? formatDuration(duration) : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
