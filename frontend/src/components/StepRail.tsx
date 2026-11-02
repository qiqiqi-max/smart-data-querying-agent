/**
 * 智能体执行链路组件 (CI/CD 节点流水线风格)
 * 工业级节点监控、执行耗时与拓扑状态
 */
import {
  Check,
  ChevronRight,
  Circle,
  Clock,
  Cpu,
  LoaderCircle,
  Square,
  Terminal,
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
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function StepBadge({ status }: { status: StepStatus }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.2 font-mono text-[10px] font-bold text-amber-700 border border-amber-200">
        <LoaderCircle className="h-2.5 w-2.5 animate-spin" />
        RUN
      </span>
    );
  }
  if (status === "success") {
    return (
      <span className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.2 font-mono text-[10px] font-bold text-emerald-700 border border-emerald-200">
        <Check className="h-2.5 w-2.5 stroke-[3]" />
        PASS
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.2 font-mono text-[10px] font-bold text-rose-700 border border-rose-200">
        <X className="h-2.5 w-2.5 stroke-[3]" />
        FAIL
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] font-bold text-slate-500 border border-slate-200">
        <Square className="h-2 w-2 fill-current" />
        STOP
      </span>
    );
  }
  return (
    <span className="rounded bg-slate-50 px-1.5 py-0.2 font-mono text-[10px] text-slate-400 border border-slate-200">
      WAIT
    </span>
  );
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

  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50/80 font-mono text-xs overflow-hidden">
      {/* 管道概览栏 */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-100/70 transition"
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-bold text-slate-700">PIPELINE:</span>
          <span className={cn(
            "text-[11px] font-semibold",
            trace === "running" ? "text-amber-700" :
            trace === "error" ? "text-rose-700" : "text-slate-700"
          )}>
            {trace === "running" ? `EXEC[${running?.step ?? "START"}]` :
             trace === "error" ? `FAILED[${failed?.step ?? "ERR"}]` :
             trace === "stopped" ? "ABORTED" : "COMPLETED"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">
            {done}/{total} STAGES
          </span>
          <span className="h-3 w-[1px] bg-slate-200" />
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(elapsed)}
          </span>
          <ChevronRight className={cn("h-3 w-3 text-slate-400 transition-transform", open && "rotate-90")} />
        </div>
      </button>

      {/* 进度微线条 */}
      {trace === "running" && (
        <div className="h-0.5 bg-slate-200">
          <div
            className="h-full bg-brand-600 transition-all duration-300"
            style={{ width: `${Math.max((done / total) * 100, 5)}%` }}
          />
        </div>
      )}

      {/* 展开的流水线阶段清单 */}
      {open && (
        <div className="border-t border-slate-200 bg-white p-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {names.map((name, index) => {
              const step = byName.get(name);
              const stepStatus = statusOf(name);
              const duration = step && (stepStatus === "running" ? now : step.updatedAt) - step.startedAt;
              return (
                <div
                  key={name}
                  className="flex items-center justify-between rounded border border-slate-100 bg-slate-50/50 px-2 py-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 w-4">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-sans text-slate-700">{name}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">
                      {duration ? formatDuration(duration) : ""}
                    </span>
                    <StepBadge status={stepStatus} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
