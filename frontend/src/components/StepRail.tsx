/**
 * 智能体执行链路组件 (CI/CD 节点流水线风格)
 * 工业级节点监控、执行耗时与拓扑状态
 */
import {
  Check,
  ChevronRight,
  Clock,
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
  "检查问题与数据",
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

type TraceStatus = "running" | "done" | "error" | "stopped" | "clarify" | "unsupported";
type StepStatus = StepState["status"] | "pending" | "stopped";

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(Math.round(ms), 0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function StepBadge({ status }: { status: StepStatus }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-sans text-sm font-bold text-amber-700 border border-amber-200">
        <LoaderCircle className="h-2.5 w-2.5 animate-spin" />
        执行中
      </span>
    );
  }
  if (status === "success") {
    return (
      <span className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-sans text-sm font-bold text-emerald-700 border border-emerald-200">
        <Check className="h-2.5 w-2.5 stroke-[3]" />
        完成
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 font-sans text-sm font-bold text-rose-700 border border-rose-200">
        <X className="h-2.5 w-2.5 stroke-[3]" />
        失败
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-sans text-sm font-bold text-slate-600 border border-slate-200">
        <Square className="h-2 w-2 fill-current" />
        已停止
      </span>
    );
  }
  return (
    <span className="rounded bg-slate-50 px-1.5 py-0.5 font-sans text-sm text-slate-600 border border-slate-200">
      等待
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
  const businessReply = trace === "clarify" || trace === "unsupported";
  const names = businessReply ? steps.map(step => step.step) : [
    ...stepOrder.filter((name) => corrected || name !== "校正SQL"),
    ...steps.map((step) => step.step).filter((name) => !stepOrder.includes(name)),
  ];
  const statusOf = (name: string): StepStatus => {
    const current = byName.get(name)?.status ?? "pending";
    return trace === "stopped" && current === "running" ? "stopped" : current;
  };

  const done = names.filter((name) => stepOrder.includes(name) && statusOf(name) === "success").length;
  const total = businessReply ? names.length : stepOrder.length - (corrected ? 0 : 1);
  const running = trace === "running"
    ? [...steps].reverse().find((step) => step.status === "running")
    : undefined;
  const failed = byName.has("SQL校验失败")
    ? byName.get("SQL校验失败")
    : [...steps].reverse().find((step) => step.status === "error");
  const elapsed = (finishedAt ?? (trace === "running" ? now : steps[steps.length - 1].updatedAt)) - startedAt;

  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50/80 font-sans text-sm overflow-hidden">
      {/* 管道概览栏 */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-12 w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3 text-left transition hover:bg-slate-100/70"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-slate-600" />
          <span className="font-semibold text-slate-800">执行步骤</span>
          <span className={cn(
            "text-sm font-semibold",
            trace === "running" ? "text-amber-700" :
            trace === "error" ? "text-rose-700" : "text-slate-700"
          )}>
            {trace === "running" ? `正在${running?.step ?? "启动"}` :
             trace === "error" ? `${failed?.step ?? "查询"}失败` :
             trace === "stopped" ? "已停止" : trace === "clarify" ? "等待补充信息" : trace === "unsupported" ? "数据不足" : "已完成"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">
            {done}/{total} 步
          </span>
          <span className="h-3 w-[1px] bg-slate-200" />
          <span className="flex items-center gap-1 text-sm text-slate-600">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(elapsed)}
          </span>
          <ChevronRight className={cn("h-3 w-3 text-slate-600 transition-transform", open && "rotate-90")} />
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
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {names.map((name, index) => {
              const step = byName.get(name);
              const stepStatus = statusOf(name);
              const duration = step && (stepStatus === "running" ? now : step.updatedAt) - step.startedAt;
              return (
                <div
                  key={name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50/50 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-600 w-4">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-sm font-sans text-slate-700">{name}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-slate-600">
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
