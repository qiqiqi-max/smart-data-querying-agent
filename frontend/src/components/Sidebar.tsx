/**
 * 左侧边栏
 * 品牌、新对话、最近分析记录和接口信息；桌面端常驻，窄屏下作为抽屉打开
 */
import { BarChart3, LoaderCircle, MessageSquarePlus, Server, Trash2, X } from "lucide-react";
import { cn, formatTime } from "../lib/format";
import type { RunStatus, RunSummary } from "../types/agent";

type SidebarProps = {
  apiBaseUrl: string;
  isStreaming: boolean;
  recentRuns: RunSummary[];
  activeRunId: string | null;
  onNewChat: () => void;
  onOpenRun: (run: RunSummary) => void;
  onDeleteRun: (run: RunSummary) => void;
  // 只在抽屉模式下传入，用于显示关闭按钮
  onClose?: () => void;
};

const STATUS_STYLE: Record<RunStatus, { dot: string; label: string }> = {
  running: { dot: "bg-brass", label: "运行中" },
  done: { dot: "bg-moss", label: "完成" },
  error: { dot: "bg-tomato", label: "异常" },
  stopped: { dot: "bg-slate-300", label: "已停止" },
};

export function Sidebar({
  apiBaseUrl,
  isStreaming,
  recentRuns,
  activeRunId,
  onNewChat,
  onOpenRun,
  onDeleteRun,
  onClose,
}: SidebarProps) {
  const doneCount = recentRuns.filter((run) => run.status === "done").length;
  const errorCount = recentRuns.filter((run) => run.status === "error").length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-moss/10 text-moss">
          <BarChart3 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">电商问数</div>
          <div className="text-xs text-slate-500">自然语言查询数仓</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onNewChat}
          disabled={isStreaming}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          新对话
        </button>
      </div>

      <div className="mt-5 px-4 pb-2 text-xs font-medium text-slate-500">最近分析</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {recentRuns.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-slate-400">还没有查询记录</div>
        ) : (
          <ul className="space-y-0.5">
            {recentRuns.map((run) => {
              const style = STATUS_STYLE[run.status];
              return (
                <li key={run.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpenRun(run)}
                    disabled={isStreaming}
                    className={cn(
                      "w-full rounded-lg px-2.5 py-2 pr-9 text-left transition hover:bg-slate-100 disabled:cursor-not-allowed",
                      run.id === activeRunId && "bg-slate-100",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {run.status === "running" ? (
                        <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-brass" aria-hidden="true" />
                      ) : (
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", style.dot)} title={style.label} />
                      )}
                      <span className="truncate text-sm text-slate-800">{run.query}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 pl-4 text-[11px] text-slate-400">
                      <span>{formatTime(run.createdAt)}</span>
                      <span>·</span>
                      <span>{run.status === "done" ? `${run.rows ?? 0} 行` : style.label}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={run.status === "running"}
                    onClick={() => onDeleteRun(run)}
                    className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 opacity-0 transition hover:bg-white hover:text-tomato focus:opacity-100 group-hover:opacity-100 disabled:hidden"
                    title="删除记录"
                    aria-label={`删除 ${run.query}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5" aria-hidden="true" />
            接口
          </span>
          <span className="truncate font-mono text-slate-600">{apiBaseUrl}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span>最近 {recentRuns.length} 条</span>
          <span>
            完成 {doneCount} · 异常 {errorCount}
          </span>
        </div>
      </div>
    </div>
  );
}
