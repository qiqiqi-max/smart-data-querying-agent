/**
 * 前端应用主组件
 * 负责会话状态、SSE 消费和两栏工作台布局（左侧记录栏 + 右侧对话区，窄屏下记录栏为抽屉）
 */
import { Eraser, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { MessageBubble } from "./components/MessageBubble";
import { Sidebar } from "./components/Sidebar";
import { deleteQueryHistory, fetchQueryHistory, fetchQueryHistoryDetail, streamQuery } from "./lib/agentApi";
import { cn, countResultRows, isTruncatedSummary, summarizeResult } from "./lib/format";
import type {
  AgentEvent,
  ChatMessage,
  QueryHistorySummary,
  QueryResponse,
  RunSummary,
  StepState,
} from "./types/agent";

const examples = [
  "统计 2025 年第一季度各大区的 GMV，并按 GMV 从高到低排序",
  "统计 2025 年 3 月各商品品类的销量和销售额",
  "查询华东地区 2025 年第一季度销售额最高的前 5 个商品",
  "按会员等级统计 2025 年第一季度的订单数和销售额",
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "Vite /api proxy";
const RUNS_STORAGE_KEY = "smart-data-querying-agent.recent-runs";
const MAX_RECENT_RUNS = 6;

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadRecentRuns(): RunSummary[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(RUNS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as RunSummary[];
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, MAX_RECENT_RUNS).map(({ result, sql, ...summary }) => summary);
  } catch {
    return [];
  }
}

function historyToRun(history: QueryHistorySummary): RunSummary {
  return {
    id: history.id,
    query: history.query,
    status: history.status,
    summary: history.summary ?? "",
    createdAt: new Date(history.created_at).getTime(),
    updatedAt: new Date(history.updated_at).getTime(),
    rows: history.row_count,
    error: history.error ?? undefined,
  };
}

function upsertRun(
  runs: RunSummary[],
  runId: string,
  patch: Partial<Omit<RunSummary, "id" | "createdAt">>,
) {
  const now = Date.now();
  const current = runs.find((run) => run.id === runId);

  const nextRun: RunSummary = current
    ? { ...current, ...patch, updatedAt: now }
    : {
        id: runId,
        query: patch.query ?? "",
        status: patch.status ?? "running",
        summary: patch.summary ?? "",
        createdAt: patch.updatedAt ?? now,
        updatedAt: now,
        rows: patch.rows,
        error: patch.error,
        result: patch.result,
        sql: patch.sql,
      };

  return [nextRun, ...runs.filter((run) => run.id !== runId)].slice(0, MAX_RECENT_RUNS);
}

// 同一步骤的 running 和 success 事件合并成一条，保留第一次出现的时间用于计算耗时
function upsertStep(steps: StepState[] = [], event: Extract<AgentEvent, { type: "progress" }>) {
  const now = Date.now();
  const previous = steps.find((item) => item.step === event.step);
  return [
    ...steps.filter((item) => item.step !== event.step),
    { step: event.step, status: event.status, startedAt: previous?.startedAt ?? now, updatedAt: now },
  ];
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [activeController, setActiveController] = useState<AbortController | null>(null);
  const [pendingParentHistoryId, setPendingParentHistoryId] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>(() => loadRecentRuns());
  // 当前打开的历史记录，用于在侧边栏高亮
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<{ run: RunSummary; message: string } | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const historyLoadId = useRef<string | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const isStreaming = Boolean(activeController);

  useEffect(() => () => activeController?.abort(), [activeController]);
  const canSubmit = draft.trim().length > 0 && !isStreaming;

  useEffect(() => {
    try {
      const summaries = recentRuns.map(({ result, sql, ...summary }) => summary);
      window.localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(summaries));
    } catch {
      // 本地历史只是增强体验，写入失败不影响主流程
    }
  }, [recentRuns]);

  const refreshHistory = async () => {
    setHistoryStatus("loading");
    try {
      const histories = await fetchQueryHistory(MAX_RECENT_RUNS);
      setRecentRuns(histories.map(historyToRun));
      setHistoryStatus("ready");
    } catch {
      setHistoryStatus("error");
      // 后端历史不可用时保留本地记录，不打断当前问数流程
    }
  };

  useEffect(() => {
    void refreshHistory();
    return () => historyController.current?.abort();
  }, []);

  const cancelHistoryLoad = () => {
    historyController.current?.abort();
    historyController.current = null;
    historyLoadId.current = null;
    setLoadingHistoryId(null);
    setHistoryError(null);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
      if (event.key === "Tab") {
        const buttons = drawerRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [drawerOpen]);

  const startQuery = async (rawQuery = draft) => {
    const query = rawQuery.trim();
    if (!query || isStreaming) return;
    cancelHistoryLoad();

    const startedAt = Date.now();
    const parentHistoryId = pendingParentHistoryId ?? undefined;
    setPendingParentHistoryId(null);
    const runId = makeId();
    const assistantId = makeId();

    const controller = new AbortController();
    setActiveController(controller);
    setActiveRunId(null);
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: makeId(), role: "user", content: query, createdAt: startedAt },
      {
        id: assistantId,
        role: "assistant",
        content: "正在理解问题…",
        createdAt: startedAt,
        status: "streaming",
        steps: [],
        query,
      },
    ]);
    setRecentRuns((current) =>
      upsertRun(current, runId, { query, status: "running", summary: "连接中...", updatedAt: startedAt }),
    );

    const patchRun = (patch: Partial<Omit<RunSummary, "id" | "createdAt">>) => {
      setRecentRuns((current) => upsertRun(current, runId, patch));
    };
    const patchAssistant = (patch: (message: ChatMessage) => Partial<ChatMessage>) => {
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, ...patch(message) } : message)),
      );
    };

    const onEvent = (event: AgentEvent) => {
      if (event.type === "assessment") {
        setPendingParentHistoryId(event.status === "clarify" ? event.history_id : null);
        setActiveRunId(event.history_id);
        patchAssistant(() => ({ status: event.status, content: event.message, response: event, error: undefined, result: undefined, sql: undefined, finishedAt: Date.now() }));
        patchRun({ status: event.status, summary: event.message, rows: 0, error: undefined, result: undefined, sql: undefined });
        return;
      }
      if (event.type === "progress") {
        patchAssistant((message) => ({ steps: upsertStep(message.steps, event) }));
        patchRun({ status: event.status === "error" ? "error" : "running", summary: `执行：${event.step}` });
        return;
      }

      if (event.type === "result") {
        setPendingParentHistoryId(null);
        const summary = summarizeResult(event.data, event.truncated);
        patchAssistant(() => ({
          status: "done",
          content: summary,
          result: event.data,
          truncated: event.truncated,
          sql: event.sql,
          finishedAt: Date.now(),
        }));
        patchRun({ status: "done", summary, rows: countResultRows(event.data), result: event.data, sql: event.sql });
        return;
      }

      setPendingParentHistoryId(null);
      patchAssistant(() => ({
        status: "error",
        response: undefined,
        content: "这次查询没有成功。",
        error: event.message,
        sql: event.sql ?? undefined,
        finishedAt: Date.now(),
      }));
      patchRun({ status: "error", summary: event.message, error: event.message });
    };

    try {
      await streamQuery(query, { signal: controller.signal, onEvent, parentHistoryId });
      await refreshHistory();
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId && message.status === "streaming"
            ? { ...message, status: "done", content: "流程已结束。", finishedAt: Date.now() }
            : message,
        ),
      );
    } catch (error) {
      setPendingParentHistoryId(null);
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const message = error instanceof Error ? error.message : String(error);

      patchAssistant(() => ({
        status: isAbort ? "stopped" : "error",
        response: undefined,
        content: isAbort ? "已停止本次查询。" : "本次查询未能完成。",
        error: isAbort ? undefined : message,
        finishedAt: Date.now(),
      }));
      // 与后端 mark_interrupted 写入的 stopped 状态保持一致，刷新历史后不会跳变
      patchRun(
        isAbort
          ? { status: "stopped", summary: "已停止本次查询。" }
          : { status: "error", summary: message, error: message },
      );
      await refreshHistory();
    } finally {
      setActiveController(null);
    }
  };

  const stopQuery = () => {
    activeController?.abort();
  };

  const newChat = () => {
    if (isStreaming) return;
    cancelHistoryLoad();
    setMessages([]);
    setPendingParentHistoryId(null);
    setDraft("");
    setActiveRunId(null);
    setDrawerOpen(false);
  };

  // 示例只填入输入框，用户可以先修改再发送
  const fillExample = (example: string) => {
    setDraft(example);
    inputRef.current?.focus();
  };

  const showHistory = (run: RunSummary, response?: QueryResponse | null) => {

    setPendingParentHistoryId(run.status === "clarify" && response?.status === "clarify" ? run.id : null);
    setDraft("");
    setActiveRunId(run.id);
    setDrawerOpen(false);
    setMessages([
      { id: makeId(), role: "user", content: run.query, createdAt: run.createdAt },
      {
        id: makeId(),
        role: "assistant",
        content: run.summary || (run.status === "error" ? "这次查询没有成功。" : "历史记录已打开。"),
        createdAt: run.updatedAt,
        status: run.status === "running" ? "streaming" : run.status,
        result: run.result ?? undefined,
        truncated: isTruncatedSummary(run.summary),
        sql: run.sql,
        query: run.query,
        error: run.error,
        response: response ?? undefined,
      },
    ]);
  };

  const openHistory = async (run: RunSummary) => {
    if (isStreaming) return;
    cancelHistoryLoad();
    setPendingParentHistoryId(null);
    setDrawerOpen(false);
    // 当前会话的结果可直接打开；服务器历史每次打开都请求最新详情。
    if (run.result !== undefined) {
      showHistory(run);
      return;
    }
    const controller = new AbortController();
    historyController.current = controller;
    historyLoadId.current = run.id;
    setLoadingHistoryId(run.id);
    try {
      const history = await fetchQueryHistoryDetail(run.id, controller.signal);
      if (controller.signal.aborted || historyController.current !== controller) return;
      showHistory({ ...historyToRun(history), result: history.result, sql: history.sql ?? undefined }, history.response);
    } catch (error) {
      if (controller.signal.aborted || historyController.current !== controller) return;
      setHistoryError({ run, message: error instanceof Error ? error.message : "历史详情加载失败，请重试。" });
    } finally {
      if (historyController.current === controller) {
        historyController.current = null;
        historyLoadId.current = null;
        setLoadingHistoryId(null);
      }
    }
  };

  const deleteRun = async (run: RunSummary) => {
    if (run.status === "running") return;
    if (!window.confirm("删除这条查询记录？")) return;
    try {
      await deleteQueryHistory(run.id);
      setPendingParentHistoryId(current => current === run.id ? null : current);
      if (historyLoadId.current === run.id) cancelHistoryLoad();
      setHistoryError((current) => current?.run.id === run.id ? null : current);
      setRecentRuns((current) => current.filter((item) => item.id !== run.id));
      setActiveRunId((current) => current === run.id ? null : current);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    }
  };

  const sidebarProps = {
    apiBaseUrl: API_BASE_URL,
    historyStatus,
    loadingHistoryId,
    isStreaming,
    recentRuns,
    activeRunId,
    onNewChat: newChat,
    onOpenRun: openHistory,
    onDeleteRun: deleteRun,
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-white">
      {/* 桌面端侧边栏 */}
      <aside className="hidden w-80 shrink-0 flex-col border-r border-slate-300 lg:flex">
        <Sidebar {...sidebarProps} />
      </aside>

      {/* 移动端侧边栏抽屉 */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        />
      )}
      {drawerOpen && (
        <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="查询历史"
          className="fixed left-0 top-0 z-50 h-dvh w-80 max-w-[90vw] bg-white lg:hidden">
          <Sidebar {...sidebarProps} onClose={() => setDrawerOpen(false)} />
        </div>
      )}

      {/* 主工作区 */}
      <main inert={drawerOpen} className="flex min-w-0 flex-1 flex-col bg-slate-100/70">
        {/* 顶部专业 BI 控制台 Bar */}
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              disabled={isStreaming}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 lg:hidden disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="打开侧边栏"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-900 sm:text-base">
                数据分析工作台
              </span>
            </div>

          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span className={cn(
                "inline-block h-2 w-2 rounded-full",
                isStreaming ? "bg-amber-500 animate-ping" : "bg-emerald-500"
              )} />
              <span>{isStreaming ? "执行中" : "就绪"}</span>
            </div>

            {messages.length > 0 && (
              <>
                <span className="h-3 w-[1px] bg-slate-200" />
                <button
                  type="button"
                  onClick={newChat}
                  disabled={isStreaming}
                  aria-label="重置画布"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Eraser className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">新建分析</span>
                </button>
              </>
            )}
          </div>
        </header>

        {loadingHistoryId && <div role="status" className="border-b border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">正在加载历史结果…</div>}
        {historyError && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>{historyError.message}</span>
            <button type="button" className="min-h-11 shrink-0 rounded-lg border border-amber-300 px-3 py-2" onClick={() => void openHistory(historyError.run)}>重试加载</button>
          </div>
        )}

        {/* 对话与图表区域 */}
        <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
          {messages.length === 0 ? (
            <EmptyState examples={examples} onUseExample={fillExample} />
          ) : (
            <div className="mx-auto w-full max-w-6xl px-3 py-6 sm:px-8">
              <div className="space-y-5">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部控制台输入区 */}
        <div className="relative shrink-0 border-t border-slate-300 bg-white p-3 sm:px-8 sm:py-4">
          <div className="mx-auto max-w-6xl">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={startQuery}
              disabled={!canSubmit}
              isStreaming={isStreaming}
              inputRef={inputRef}
              onStop={stopQuery}
              isClarifying={Boolean(pendingParentHistoryId)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
