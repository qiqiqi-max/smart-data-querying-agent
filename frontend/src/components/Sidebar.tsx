/**
 * 左侧边栏 (B2B BI 风格)
 * 工业级灰白布局、数仓连接拓扑、会话记录与多维指标状态
 */
import {
  Activity,
  CheckCircle2,
  Database,
  History,
  Layers,
  LoaderCircle,
  Plus,
  Server,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { cn, formatTime } from "../lib/format";
import type { RunStatus, RunSummary } from "../types/agent";

type SidebarProps = {
  apiBaseUrl: string;
  historyStatus: "loading" | "ready" | "error";
  loadingHistoryId: string | null;
  isStreaming: boolean;
  recentRuns: RunSummary[];
  activeRunId: string | null;
  onNewChat: () => void;
  onOpenRun: (run: RunSummary) => void;
  onDeleteRun: (run: RunSummary) => void;
  onClose?: () => void;
};

const STATUS_MAP: Record<
  RunStatus,
  { label: string; tagClass: string; icon: typeof CheckCircle2 }
> = {
  running: {
    label: "查询中",
    tagClass: "bg-amber-50 text-amber-700 border-amber-200",
    icon: LoaderCircle,
  },
  done: {
    label: "已完成",
    tagClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
  },
  error: {
    label: "失败",
    tagClass: "bg-rose-50 text-rose-700 border-rose-200",
    icon: XCircle,
  },
  stopped: {
    label: "已停止",
    tagClass: "bg-slate-100 text-slate-600 border-slate-200",
    icon: Activity,
  },
  clarify: {
    label: "待补充",
    tagClass: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Activity,
  },
  unsupported: {
    label: "数据不足",
    tagClass: "bg-slate-100 text-slate-600 border-slate-200",
    icon: Database,
  },
};

export function Sidebar({
  apiBaseUrl,
  historyStatus,
  loadingHistoryId,
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
    <div className="flex h-full min-h-0 flex-col bg-white border-r border-slate-200">
      {/* 品牌 / 数仓工作空间标头 */}
      <div className="flex min-h-20 items-center justify-between border-b border-slate-200 bg-slate-50/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-700 text-white shadow-subtle">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="text-base font-bold text-slate-900">
                电商问数
              </span>
            </div>
            <p className="mt-1 font-sans text-sm text-slate-600">
              智能数据分析工作台
            </p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-200/60 hover:text-slate-700"
            aria-label="关闭侧边栏"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* 新建问数会话按钮 */}
      <div className="p-2.5">
        <button
          type="button"
          onClick={onNewChat}
          disabled={isStreaming}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand-700 bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-subtle transition hover:bg-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-600"
        >
          <Plus className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
          <span>新建分析查询</span>
        </button>
      </div>

      {/* 历史分析查询列表 */}
      <div className="flex items-center justify-between px-3 py-1.5 text-sm font-bold tracking-wider text-slate-600 uppercase font-sans">
        <span className="flex items-center gap-1">
          <History className="h-3 w-3" />
          最近查询
        </span>
        <span>{recentRuns.length} 条</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {recentRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <Layers className="h-6 w-6 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-600">暂无查询记录</p>
          </div>
        ) : (
          <div className="space-y-1">
            {recentRuns.map((run) => {
              const statusCfg = STATUS_MAP[run.status];
              const isActive = run.id === activeRunId;

              return (
                <div key={run.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpenRun(run)}
                    disabled={isStreaming}
                    aria-busy={loadingHistoryId === run.id}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed",
                      isActive
                        ? "border-brand-500/40 bg-brand-50/50 text-slate-900 shadow-subtle"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50 text-slate-700",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 pr-10">
                      <span className={cn(
                        "rounded px-1 py-0.5 font-sans text-sm font-bold border",
                        statusCfg.tagClass
                      )}>
                        {statusCfg.label}
                      </span>
                      <span className="font-sans text-sm text-slate-600">
                        {formatTime(run.createdAt)}
                      </span>
                    </div>

                    <p className="mt-2 line-clamp-2 text-sm font-medium leading-relaxed" title={run.query}>
                      {run.query}
                    </p>

                    <div className="mt-1 flex items-center justify-between font-sans text-sm text-slate-600">
                      <span>{run.rows !== undefined ? `${run.rows} 行结果` : "等待结果"}</span>
                      {loadingHistoryId === run.id && <span className="flex items-center gap-1"><LoaderCircle className="h-3 w-3 animate-spin" />加载中</span>}
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={run.status === "running"}
                    onClick={() => onDeleteRun(run)}
                    className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-lg text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:hidden"
                    title="移除记录"
                    aria-label={`删除 ${run.query}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部引擎拓扑与状态 */}
      <a href="#/admin" aria-disabled={isStreaming} onClick={event => { if (isStreaming) event.preventDefault(); }} className="mx-3 mb-3 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 aria-disabled:opacity-50">
        <Server className="h-4 w-4" aria-hidden="true" /> 后台管理
      </a>
      <div className="border-t border-slate-200 bg-slate-50/70 p-2.5 font-sans text-sm">
        <div className="flex items-center justify-between text-slate-600">
          <span className="flex items-center gap-1 text-sm uppercase font-bold text-slate-600">
            <Server className="h-3 w-3" />
            历史服务
          </span>
          <span role="status" className={cn("flex items-center gap-1 text-sm font-semibold",
            historyStatus === "ready" ? "text-emerald-700" : historyStatus === "error" ? "text-amber-700" : "text-slate-600")}>
            {historyStatus === "loading" ? "正在同步" : historyStatus === "ready" ? "历史已同步" : "暂不可用"}
          </span>
        </div>
        <div className="mt-1.5 truncate rounded bg-white px-2 py-1 text-sm text-slate-600 border border-slate-200">
          {apiBaseUrl}
        </div>
        {historyStatus === "error" && <p className="mt-1.5 text-sm text-amber-700">显示本机缓存，历史记录尚未同步。</p>}
        <div className="mt-2 flex items-center justify-between text-sm text-slate-600 pt-1 border-t border-slate-200/60">
          <span>共 {recentRuns.length} 条</span>
          <span className="space-x-1.5">
            <span className="text-emerald-700">完成 {doneCount}</span>
            {errorCount > 0 && <span className="text-rose-700">失败 {errorCount}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
