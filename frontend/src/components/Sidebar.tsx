/**
 * 左侧边栏
 * 品牌、新对话、最近分析记录和接口信息；桌面端常驻，窄屏下作为抽屉打开
 */
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Database,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Server,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
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
  onClose?: () => void;
};

const STATUS_CONFIG: Record<
  RunStatus,
  { text: string; label: string; icon: typeof CheckCircle2 }
> = {
  running: {
    text: "text-amber-600",
    label: "运行中",
    icon: LoaderCircle,
  },
  done: {
    text: "text-emerald-600",
    label: "完成",
    icon: CheckCircle2,
  },
  error: {
    text: "text-rose-600",
    label: "异常",
    icon: XCircle,
  },
  stopped: {
    text: "text-slate-400",
    label: "已停止",
    icon: Activity,
  },
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
    <div className="flex h-full min-h-0 flex-col bg-slate-50/70 backdrop-blur-md">
      {/* 品牌 Header */}
      <div className="flex items-center justify-between border-b border-slate-200/60 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-moss-600 to-moss-800 text-white shadow-sm ring-1 ring-black/5">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
            <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold tracking-tight text-slate-900">
                DataQuery
              </span>
              <span className="rounded-md bg-moss-50 px-1.5 py-0.5 text-[10px] font-semibold text-moss-700 ring-1 ring-inset ring-moss-600/20">
                Agent
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-500">
              电商数仓智能问数
            </p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700"
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* 新对话按钮 */}
      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={onNewChat}
          disabled={isStreaming}
          className="group relative flex h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-slate-900 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-card focus:outline-none focus:ring-2 focus:ring-slate-900/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          <MessageSquarePlus className="h-4 w-4 transition-transform group-hover:scale-110" aria-hidden="true" />
          <span>开启新对话</span>
        </button>
      </div>

      {/* 最近分析列表 */}
      <div className="mt-4 flex items-center justify-between px-4 pb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        <span className="flex items-center gap-1.5">
          <History className="h-3 w-3" />
          最近分析
        </span>
        <span className="rounded-full bg-slate-200/70 px-1.5 py-0.2 text-[10px] font-medium text-slate-600">
          {recentRuns.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {recentRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400">
              <Database className="h-5 w-5" />
            </div>
            <p className="mt-3 text-xs font-medium text-slate-600">暂无历史查询</p>
            <p className="mt-1 text-[11px] text-slate-400">
              在右侧输入问题开始分析数据
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {recentRuns.map((run) => {
              const config = STATUS_CONFIG[run.status];
              const isActive = run.id === activeRunId;
              const Icon = config.icon;

              return (
                <li key={run.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpenRun(run)}
                    disabled={isStreaming}
                    className={cn(
                      "w-full rounded-xl p-2.5 pr-8 text-left transition-all duration-150 disabled:cursor-not-allowed",
                      isActive
                        ? "bg-white shadow-card ring-1 ring-slate-200/80"
                        : "hover:bg-slate-200/50 hover:text-slate-900",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0">
                        {run.status === "running" ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-amber-500" />
                        ) : (
                          <Icon className={cn("h-3.5 w-3.5", config.text)} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          "truncate text-[13px] font-medium",
                          isActive ? "text-slate-900 font-semibold" : "text-slate-700 group-hover:text-slate-900"
                        )}>
                          {run.query}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                          <span>{formatTime(run.createdAt)}</span>
                          <span>·</span>
                          {run.status === "done" ? (
                            <span className="font-mono text-slate-500">
                              {run.rows ?? 0} 行
                            </span>
                          ) : (
                            <span className={cn("font-medium", config.text)}>
                              {config.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={run.status === "running"}
                    onClick={() => onDeleteRun(run)}
                    className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-slate-400 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100 disabled:hidden"
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

      {/* 底部系统状态与接口信息 */}
      <div className="border-t border-slate-200/60 bg-white/50 p-3 text-xs backdrop-blur-sm">
        <div className="rounded-lg bg-slate-100/70 p-2.5">
          <div className="flex items-center justify-between text-slate-600">
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <Server className="h-3.5 w-3.5 text-slate-500" />
              API 端点
            </span>
            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              就绪
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={apiBaseUrl}>
            {apiBaseUrl}
          </p>

          <div className="mt-2.5 flex items-center justify-between border-t border-slate-200/60 pt-2 text-[10px] text-slate-500">
            <span>记录 {recentRuns.length} 条</span>
            <span className="space-x-1">
              <span className="text-emerald-600">● 成功 {doneCount}</span>
              {errorCount > 0 && <span className="text-rose-600">● 失败 {errorCount}</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
