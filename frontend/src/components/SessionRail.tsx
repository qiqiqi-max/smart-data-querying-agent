/**
 * 会话轨迹侧栏
 * 展示当前会话状态、最近分析记录和结果摘要
 */
import { Activity, Clock3, ListChecks, MessageSquareText, Trash2 } from "lucide-react";
import { cn, formatTime } from "../lib/format";
import type { RunSummary } from "../types/agent";

type SessionRailProps = {
  apiBaseUrl: string;
  isStreaming: boolean;
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  currentStep?: string;
  latestRun: RunSummary | null;
  recentRuns: RunSummary[];
  onOpenRun: (run: RunSummary) => void;
  onDeleteRun: (run: RunSummary) => void;
};

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-2.5 w-2.5 shrink-0 rounded-full",
        active ? "bg-moss shadow-[0_0_0_4px_rgba(15,118,110,0.14)]" : "bg-slate-300",
      )}
      aria-hidden="true"
    />
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 bg-white/85 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function SessionRail({
  apiBaseUrl,
  isStreaming,
  totalRuns,
  successRuns,
  errorRuns,
  currentStep,
  latestRun,
  recentRuns,
  onOpenRun,
  onDeleteRun,
}: SessionRailProps) {
  return (
    <aside className="hidden min-h-0 border-l border-slate-200/90 bg-slate-50/90 xl:flex xl:flex-col">
      <div className="border-b border-slate-200 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Session</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">运行概览</div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
            <StatusDot active={isStreaming} />
            {isStreaming ? "运行中" : "就绪"}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatCard label="查询" value={String(totalRuns)} />
          <StatCard label="成功" value={String(successRuns)} />
          <StatCard label="失败" value={String(errorRuns)} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section className="border border-slate-200 bg-white/88 p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Activity className="h-4 w-4 text-moss" aria-hidden="true" />
            当前状态
          </div>
          <div className="mt-3 grid gap-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                步骤
              </span>
              <span className="truncate text-right text-slate-900">{currentStep ?? "待开始"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-slate-400" aria-hidden="true" />
                最新
              </span>
              <span className="truncate text-right text-slate-900">{latestRun?.summary ?? "暂无"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-slate-400" aria-hidden="true" />
                接口
              </span>
              <span className="truncate text-right font-mono text-xs text-slate-700">{apiBaseUrl}</span>
            </div>
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MessageSquareText className="h-4 w-4 text-moss" aria-hidden="true" />
            最近分析
          </div>
          <div className="space-y-2">
            {recentRuns.length === 0 ? (
              <div className="border border-dashed border-slate-200 bg-white/55 px-4 py-4 text-sm text-slate-500">
                暂无记录
              </div>
            ) : (
              recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="group w-full border border-slate-200 bg-white/90 px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-moss/30 hover:bg-white"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpenRun(run)} className="block w-full truncate text-left text-sm font-medium text-slate-900">
                        {run.query}
                      </button>
                      <div className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-slate-500">
                        {run.summary}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[11px] font-semibold",
                        run.status === "done" && "bg-moss/10 text-moss",
                        run.status === "running" && "bg-brass/10 text-brass",
                        run.status === "error" && "bg-tomato/10 text-tomato",
                        run.status === "stopped" && "bg-slate-100 text-slate-500",
                      )}
                    >
                      {run.status === "done"
                        ? "完成"
                        : run.status === "running"
                          ? "运行"
                          : run.status === "stopped"
                            ? "已停止"
                            : "异常"}
                    </span>
                    <button type="button" disabled={run.status === "running"} onClick={() => onDeleteRun(run)} className="grid h-6 w-6 place-items-center text-slate-400 transition hover:text-tomato disabled:cursor-not-allowed disabled:opacity-20" title="删除记录" aria-label={`删除 ${run.query}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                    <span>{formatTime(run.createdAt)}</span>
                    <span>{run.rows ?? 0} 行</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
