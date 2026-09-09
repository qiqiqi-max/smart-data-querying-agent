/**
 * 前端应用主组件
 * 负责会话状态、SSE 消费和三栏工作台布局
 */
import {
  Activity,
  BarChart3,
  Eraser,
  History,
  Leaf,
  MessageSquarePlus,
  Server,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { MessageBubble } from "./components/MessageBubble";
import { SessionRail } from "./components/SessionRail";
import { deleteQueryHistory, fetchQueryHistory, streamQuery } from "./lib/agentApi";
import { cn, countResultRows, summarizeResult } from "./lib/format";
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
    activeStep:
      history.status === "done" ? "执行完成" : history.status === "error" ? "异常" : "运行中",
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
        activeStep: patch.activeStep,
        error: patch.error,
        result: patch.result,
      };

  return [nextRun, ...runs.filter((run) => run.id !== runId)].slice(0, MAX_RECENT_RUNS);
}

function upsertStep(steps: StepState[] = [], event: Extract<AgentEvent, { type: "progress" }>) {
  const next = steps.filter((item) => item.step !== event.step);
  next.push({
    step: event.step,
    status: event.status,
    updatedAt: Date.now(),
  });
  return next;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [activeController, setActiveController] = useState<AbortController | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>(() => loadRecentRuns());
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  const completedCount = useMemo(
    () => recentRuns.filter((run) => run.status === "done").length,
    [recentRuns],
  );
  const errorCount = useMemo(
    () => recentRuns.filter((run) => run.status === "error").length,
    [recentRuns],
  );
  const activeRun = useMemo(
    () => recentRuns.find((run) => run.status === "running") ?? recentRuns[0] ?? null,
    [recentRuns],
  );
  const activeStep = activeRun?.activeStep ?? "待开始";

  const startQuery = async (rawQuery = draft) => {
    const query = rawQuery.trim();
    if (!query || isStreaming) return;

    const startedAt = Date.now();
    const runId = makeId();

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: query,
      createdAt: startedAt,
    };

    const assistantId = makeId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "连接中...",
      createdAt: startedAt,
      status: "streaming",
      steps: [],
    };

    const controller = new AbortController();
    setActiveController(controller);
    setDraft("");
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setRecentRuns((current) =>
      upsertRun(current, runId, {
        query,
        status: "running",
        summary: "连接中...",
        activeStep: "连接中",
        updatedAt: startedAt,
      }),
    );

    const patchRun = (patch: Partial<Omit<RunSummary, "id" | "createdAt">>) => {
      setRecentRuns((current) => upsertRun(current, runId, patch));
    };

    const onEvent = (event: AgentEvent) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== assistantId) return message;

          if (event.type === "progress") {
            return {
              ...message,
              content: event.status === "running" ? `正在执行：${event.step}` : message.content,
              steps: upsertStep(message.steps, event),
            };
          }

          if (event.type === "result") {
            return {
              ...message,
              status: "done",
              content: summarizeResult(event.data),
              result: event.data,
            };
          }

          return {
            ...message,
            status: "error",
            content: "这次查询没有成功。",
            error: event.message,
          };
        }),
      );

      if (event.type === "progress") {
        patchRun({
          status: event.status === "error" ? "error" : "running",
          activeStep: event.step,
          summary: `执行：${event.step}`,
        });
      }

      if (event.type === "result") {
        patchRun({
          status: "done",
          summary: summarizeResult(event.data),
          rows: countResultRows(event.data),
          activeStep: "执行完成",
          result: event.data,
        });
      }

      if (event.type === "error") {
        patchRun({
          status: "error",
          summary: event.message,
          error: event.message,
          activeStep: "异常",
        });
      }
    };

    try {
      await streamQuery(query, { signal: controller.signal, onEvent });
      await refreshHistory();
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId && message.status === "streaming"
            ? { ...message, status: "done", content: "流程已结束。" }
            : message,
        ),
      );
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                status: isAbort ? "done" : "error",
                content: isAbort ? "已停止本次查询。" : "无法连接问数接口。",
                error: isAbort ? undefined : error instanceof Error ? error.message : String(error),
              }
            : message,
        ),
      );

      if (isAbort) {
        patchRun({
          status: "done",
          summary: "已停止本次查询。",
          activeStep: "已停止",
        });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        patchRun({
          status: "error",
          summary: message,
          error: message,
          activeStep: "异常",
        });
      }
      await refreshHistory();
    } finally {
      setActiveController(null);
    }
  };

  const stopQuery = () => {
    activeController?.abort();
  };

  const clearConversation = () => {
    if (isStreaming) return;
    setMessages([]);
    setDraft("");
  };

  const openHistory = (run: RunSummary) => {
    if (isStreaming) return;

    setMessages([
      {
        id: makeId(),
        role: "user",
        content: run.query,
        createdAt: run.createdAt,
      },
      {
        id: makeId(),
        role: "assistant",
        content: run.summary || (run.status === "error" ? "这次查询没有成功。" : "历史记录已打开。"),
        createdAt: run.updatedAt,
        status: run.status === "error" ? "error" : "done",
        result: run.result,
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
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    }
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-parchment text-ink">
      <div className="relative grid h-[100dvh] min-w-0 overflow-hidden xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="hidden min-h-0 border-r border-slate-200/90 bg-white/85 xl:flex xl:flex-col">
          <div className="border-b border-slate-200 px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center border border-slate-200 bg-slate-50 text-moss">
                <BarChart3 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Workbench</div>
                <div className="mt-1 text-base font-semibold text-slate-900">电商问数</div>
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
              <StatusDot active={isStreaming} />
              {isStreaming ? "运行中" : "就绪"}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            <button
              type="button"
              onClick={clearConversation}
              disabled={isStreaming}
              className="flex h-11 w-full items-center justify-center gap-2 border border-slate-900 bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              新会话
            </button>

            <section>
              <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                样例
              </div>
              <div className="space-y-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => startQuery(example)}
                    className="w-full border border-slate-200 bg-white px-3 py-3 text-left text-sm leading-5 text-slate-700 transition hover:-translate-y-0.5 hover:border-moss/30 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="grid gap-2 text-xs text-slate-500">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  <Server className="h-3.5 w-3.5" aria-hidden="true" />
                  API
                </span>
                <span className="truncate font-mono text-slate-700">{API_BASE_URL}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  完成
                </span>
                <span className="text-slate-700">{completedCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                  异常
                </span>
                <span className="text-slate-700">{errorCount}</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/85 px-4 backdrop-blur lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center border border-slate-200 bg-slate-50 text-moss xl:hidden">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">智能数据分析 Agent</div>
                <div className="truncate text-xs text-slate-500">FastAPI SSE / LangGraph</div>
              </div>
            </div>
            <button
              type="button"
              onClick={clearConversation}
              disabled={messages.length === 0 || isStreaming}
              className={cn(
                "grid h-9 w-9 place-items-center border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35",
              )}
              title="清空"
              aria-label="清空"
            >
              <Eraser className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 lg:px-8">
              {messages.length === 0 ? (
                <EmptyState examples={examples} onUseExample={(example) => setDraft(example)} />
              ) : (
                <>
                  <section className="grid gap-3 md:grid-cols-3">
                    <div className="border border-slate-200 bg-white/90 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">当前问题</div>
                      <div className="mt-2 max-h-12 overflow-hidden text-sm leading-6 text-slate-900">
                        {activeRun?.query ?? "待开始"}
                      </div>
                    </div>
                    <div className="border border-slate-200 bg-white/90 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">状态</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {activeRun?.status === "running"
                          ? "运行中"
                          : activeRun?.status === "done"
                            ? "已完成"
                            : activeRun?.status === "error"
                              ? "异常"
                              : "就绪"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{activeStep}</div>
                    </div>
                    <div className="border border-slate-200 bg-white/90 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">结果</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {activeRun?.rows !== undefined ? `${activeRun.rows} 行` : "待返回"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {activeRun?.summary ?? "暂无摘要"}
                      </div>
                    </div>
                  </section>

                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50/90 px-4 py-2 text-center text-xs text-slate-500">
            <span className="inline-flex items-center gap-2">
              <Leaf className="h-3.5 w-3.5 text-moss" aria-hidden="true" />
              {isStreaming ? "运行中" : "就绪"}
            </span>
          </div>
          <Composer
            value={draft}
            disabled={!canSubmit}
            isStreaming={isStreaming}
            onChange={setDraft}
            onSubmit={() => startQuery()}
            onStop={stopQuery}
          />
        </main>

        <SessionRail
          apiBaseUrl={API_BASE_URL}
          isStreaming={isStreaming}
          totalRuns={recentRuns.length}
          successRuns={completedCount}
          errorRuns={errorCount}
          currentStep={activeStep}
          latestRun={activeRun}
          recentRuns={recentRuns}
          onOpenRun={openHistory}
          onDeleteRun={deleteRun}
        />
      </div>
    </div>
  );
}

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
