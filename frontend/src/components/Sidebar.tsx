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
    label: "QUERYING",
    tagClass: "bg-amber-50 text-amber-700 border-amber-200",
    icon: LoaderCircle,
  },
  done: {
    label: "SUCCESS",
    tagClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
  },
  error: {
    label: "ERROR",
    tagClass: "bg-rose-50 text-rose-700 border-rose-200",
    icon: XCircle,
  },
  stopped: {
    label: "ABORTED",
    tagClass: "bg-slate-100 text-slate-600 border-slate-200",
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
    <div className="flex h-full min-h-0 flex-col bg-white border-r border-slate-200">
      {/* 品牌 / 数仓工作空间标头 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-3 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-700 text-white shadow-subtle">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-mono text-xs font-bold text-slate-900 tracking-tight">
                METASPACE
              </span>
              <span className="rounded bg-slate-200/80 px-1 py-0.2 font-mono text-[9px] font-semibold text-slate-600">
                PROD
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-slate-400">
              DW://dw_ecommerce
            </p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
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
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-subtle transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 active:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          <Plus className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
          <span>新建分析查询</span>
        </button>
      </div>

      {/* 历史分析查询列表 */}
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase font-mono">
        <span className="flex items-center gap-1">
          <History className="h-3 w-3" />
          QUERY_LOGS
        </span>
        <span>{recentRuns.length} ITEMS</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {recentRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <Layers className="h-6 w-6 text-slate-300" />
            <p className="mt-2 text-xs font-medium text-slate-500">暂无查询日志</p>
          </div>
        ) : (
          <div className="space-y-1">
            {recentRuns.map((run) => {
              const statusCfg = STATUS_MAP[run.status];
              const isActive = run.id === activeRunId;
              const Icon = statusCfg.icon;

              return (
                <div key={run.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpenRun(run)}
                    disabled={isStreaming}
                    className={cn(
                      "w-full rounded border p-2 text-left transition-all duration-100 disabled:cursor-not-allowed",
                      isActive
                        ? "border-brand-500/40 bg-brand-50/50 text-slate-900 shadow-subtle"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50 text-slate-700",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn(
                        "rounded px-1 py-0.2 font-mono text-[9px] font-bold border",
                        statusCfg.tagClass
                      )}>
                        {statusCfg.label}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {formatTime(run.createdAt)}
                      </span>
                    </div>

                    <p className="mt-1 line-clamp-1 text-xs font-medium leading-snug">
                      {run.query}
                    </p>

                    <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
                      <span>{run.rows !== undefined ? `${run.rows} rows` : "0 rows"}</span>
                      {run.sql && <span className="text-slate-500 font-semibold">[SQL]</span>}
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={run.status === "running"}
                    onClick={() => onDeleteRun(run)}
                    className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 disabled:hidden"
                    title="移除记录"
                    aria-label={`删除 ${run.query}`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部引擎拓扑与状态 */}
      <div className="border-t border-slate-200 bg-slate-50/70 p-2.5 font-mono text-[11px]">
        <div className="flex items-center justify-between text-slate-500">
          <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-slate-400">
            <Server className="h-3 w-3" />
            ENGINE_INFO
          </span>
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            ONLINE
          </span>
        </div>
        <div className="mt-1.5 truncate rounded bg-white px-2 py-1 text-[10px] text-slate-600 border border-slate-200">
          {apiBaseUrl}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-200/60">
          <span>LOGS: {recentRuns.length}</span>
          <span className="space-x-1.5">
            <span className="text-emerald-700">PASS:{doneCount}</span>
            {errorCount > 0 && <span className="text-rose-600">ERR:{errorCount}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
