/**
 * 前端应用主组件
 * 负责会话状态、SSE 消费和两栏工作台布局（左侧记录栏 + 右侧对话区，窄屏下记录栏为抽屉）
 */
import { Eraser, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { MessageBubble } from "./components/MessageBubble";
import { ResultPanel } from "./components/ResultPanel";
import { Sidebar } from "./components/Sidebar";
import { deleteQueryHistory, fetchQueryHistory, streamQuery } from "./lib/agentApi";
import { cn, countResultRows, isTruncatedSummary, summarizeResult } from "./lib/format";
import type {
  AgentEvent,
  ChatMessage,
  QueryHistoryItem,
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

    return parsed.slice(0, MAX_RECENT_RUNS);
  } catch {
    return [];
  }
}

function historyToRun(history: QueryHistoryItem): RunSummary {
  return {
    id: history.id,
    query: history.query,
    status: history.status,
    summary: history.summary ?? "",
    createdAt: new Date(history.created_at).getTime(),
    updatedAt: new Date(history.updated_at).getTime(),
    rows: history.row_count,
    error: history.error ?? undefined,
    result: history.result,
    sql: history.sql ?? undefined,
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
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>(() => loadRecentRuns());
  // 当前打开的历史记录，用于在侧边栏高亮
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const isStreaming = Boolean(activeController);
  const canSubmit = draft.trim().length > 0 && !isStreaming;

  useEffect(() => {
    try {
      window.localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(recentRuns));
    } catch {
      // 本地历史只是增强体验，写入失败不影响主流程
    }
  }, [recentRuns]);

  const refreshHistory = async () => {
    try {
      const histories = await fetchQueryHistory(MAX_RECENT_RUNS);
      setRecentRuns(histories.map(historyToRun));
    } catch {
      // 后端历史不可用时保留本地记录，不打断当前问数流程
    }
  };

  useEffect(() => {
    void refreshHistory();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const startQuery = async (rawQuery = draft) => {
    const query = rawQuery.trim();
    if (!query || isStreaming) return;

    const startedAt = Date.now();
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
      if (event.type === "progress") {
        patchAssistant((message) => ({ steps: upsertStep(message.steps, event) }));
        patchRun({ status: event.status === "error" ? "error" : "running", summary: `执行：${event.step}` });
        return;
      }

      if (event.type === "result") {
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

      patchAssistant(() => ({
        status: "error",
        content: "这次查询没有成功。",
        error: event.message,
        sql: event.sql ?? undefined,
        finishedAt: Date.now(),
      }));
      patchRun({ status: "error", summary: event.message, error: event.message });
    };

    try {
      await streamQuery(query, { signal: controller.signal, onEvent });
      await refreshHistory();
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId && message.status === "streaming"
            ? { ...message, status: "done", content: "流程已结束。", finishedAt: Date.now() }
            : message,
        ),
      );
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const message = error instanceof Error ? error.message : String(error);

      patchAssistant(() => ({
        status: isAbort ? "stopped" : "error",
        content: isAbort ? "已停止本次查询。" : "无法连接问数接口。",
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
    setMessages([]);
    setDraft("");
    setActiveRunId(null);
    setDrawerOpen(false);
  };

  // 示例只填入输入框，用户可以先修改再发送
  const fillExample = (example: string) => {
    setDraft(example);
    inputRef.current?.focus();
  };

  const openHistory = (run: RunSummary) => {
    if (isStreaming) return;

    setActiveRunId(run.id);
    setDrawerOpen(false);
    setMessages([
      { id: makeId(), role: "user", content: run.query, createdAt: run.createdAt },
      {
        id: makeId(),
        role: "assistant",
        content: run.summary || (run.status === "error" ? "这次查询没有成功。" : "历史记录已打开。"),
        createdAt: run.updatedAt,
        status: run.status === "error" || run.status === "stopped" ? run.status : "done",
        result: run.result ?? undefined,
        truncated: isTruncatedSummary(run.summary),
        sql: run.sql,
        query: run.query,
        error: run.error,
      },
    ]);
  };

  const deleteRun = async (run: RunSummary) => {
    if (run.status === "running") return;
    if (!window.confirm("删除这条查询记录？")) return;
    try {
      await deleteQueryHistory(run.id);
      setRecentRuns((current) => current.filter((item) => item.id !== run.id));
      if (run.id === activeRunId) setActiveRunId(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    }
  };

  const sidebarProps = {
    apiBaseUrl: API_BASE_URL,
    isStreaming,
    recentRuns,
    activeRunId,
    onNewChat: newChat,
    onOpenRun: openHistory,
    onDeleteRun: deleteRun,
  };

  // 取最后一条助手消息
  const lastAssistantMessage = messages.findLast(
    (msg: ChatMessage) => msg.role === "assistant",
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-white">
      {/* 桌面端侧边栏 */}
      <aside className="hidden w-80 flex-col border-r border-slate-200 md:flex">
        <Sidebar {...sidebarProps} />
      </aside>

      {/* 移动端侧边栏抽屉 */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        />
      )}
      <div
        className={cn(
          "fixed left-0 top-0 z-50 h-dvh w-72 transform bg-white transition-transform duration-200 md:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar {...sidebarProps} onClose={() => setDrawerOpen(false)} />
      </div>

      {/* 主工作区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶部操作栏 */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            disabled={isStreaming}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="打开侧边栏"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={newChat}
            disabled={isStreaming}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="新建对话"
          >
            <Eraser className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* 对话区域 */}
        <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
          {messages.length === 0 ? (
            <EmptyState examples={examples} onUseExample={fillExample} />
          ) : (
            <div className="px-4 py-4 sm:px-6 sm:py-6">
              <div className="mx-auto max-w-2xl space-y-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 输入框 */}
        <div className="border-t border-slate-200 px-4 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-2xl">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={startQuery}
              disabled={!canSubmit}
              isStreaming={isStreaming}
              inputRef={inputRef}
              onStop={stopQuery}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
