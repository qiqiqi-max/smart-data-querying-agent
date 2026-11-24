/**
 * 智能体接口客户端
 * 封装后端 /api/query SSE 流式接口请求与事件解析逻辑
 */
import type { AgentEvent, QueryHistoryItem, QueryHistorySummary } from "../types/agent";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

type QueryOptions = {
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  timeoutMs?: number;
  parentHistoryId?: string;
};

export async function streamQuery(query: string, options: QueryOptions) {
  const timeout = options.timeoutMs ?? 120_000;
  const timeoutController = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  const timeoutId = window.setTimeout(() => timeoutController.abort(), timeout);

  try {
  const response = await fetch(`${API_BASE_URL}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ query, ...(options.parentHistoryId ? { parent_history_id: options.parentHistoryId } : {}) }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === "string" ? error.detail : `接口请求失败：HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("浏览器未返回可读取的流式响应。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n/);
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const event = parseSseChunk(chunk);
      if (event) {
        options.onEvent(event);
      }
    }
  }

  buffer += decoder.decode();
  const tail = parseSseChunk(buffer);
  if (tail) {
    options.onEvent(tail);
  }
  } finally {
    window.clearTimeout(timeoutId);
  }
}


export async function fetchQueryHistory(limit = 20): Promise<QueryHistorySummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/query/history?limit=${limit}`, {
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`历史记录请求失败：HTTP ${response.status}`);
  }

  return (await response.json()) as QueryHistorySummary[];
}

export async function fetchQueryHistoryDetail(historyId: string, signal?: AbortSignal): Promise<QueryHistoryItem> {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(`${API_BASE_URL}/api/query/history/${encodeURIComponent(historyId)}`, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(response.status === 404
      ? "这条历史记录已不存在，请刷新历史或重新查询。"
      : `历史详情加载失败：HTTP ${response.status}`);
  }
  return (await response.json()) as QueryHistoryItem;
}

export async function deleteQueryHistory(historyId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/query/history/${historyId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`删除查询记录失败：HTTP ${response.status}`);
  }
}

function parseSseChunk(chunk: string): AgentEvent | null {
  const payload = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, ""))
    .join("\n")
    .trim();

  if (!payload) return null;

  try {
    return JSON.parse(payload) as AgentEvent;
  } catch {
    return {
      type: "error",
      message: `无法解析后端事件：${payload}`,
    };
  }
}
