import type { QueryHistoryItem } from "../types/agent";
import type { AuditEntry, Build, ConnectionResult, DatabaseInput, Metadata, MetadataInput, ModelInput, Overview, QueryPage, SchemaTable, SettingsInput, SettingsResponse } from "../types/admin";

const BASE = `${import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? ""}/api/admin`;

async function request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; timeout?: number } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeout ?? 20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers: { Accept: "application/json", ...(options.method ? { "Content-Type": "application/json" } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(timeout.aborted ? "请求超时，请检查服务连接后重试。" : "无法连接管理服务，请检查后端是否已启动。", { cause: error });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof payload?.detail === "string" ? payload.detail : Array.isArray(payload?.detail)
      ? payload.detail.map((item: { loc?: unknown[]; msg?: string }) => `${item.loc?.join(".") ?? ""}: ${item.msg ?? "参数错误"}`).join("；") : null;
    throw new Error(detail || `请求失败（HTTP ${response.status}），请稍后重试。`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export const adminApi = {
  overview: (signal?: AbortSignal) => request<Overview>("/overview", { signal, timeout: 35_000 }),
  settings: (signal?: AbortSignal) => request<SettingsResponse>("/settings", { signal }),
  saveSettings: (body: SettingsInput) => request<SettingsResponse>("/settings", { method: "PUT", body }),
  testDatabase: (kind: "meta" | "dw", body: DatabaseInput) => request<ConnectionResult>(`/test-database/${kind}`, { method: "POST", body, timeout: 35_000 }),
  testModel: (body: ModelInput) => request<ConnectionResult>("/test-model", { method: "POST", body, timeout: 45_000 }),
  schema: (signal?: AbortSignal) => request<{ tables: SchemaTable[] }>("/schema", { signal }),
  metadata: (signal?: AbortSignal) => request<Metadata>("/metadata", { signal }),
  saveMetadata: (body: MetadataInput) => request<Metadata>("/metadata", { method: "PUT", body }),
  builds: (signal?: AbortSignal) => request<{ items: Build[] }>("/builds", { signal }),
  startBuild: () => request<Build>("/builds", { method: "POST", body: {} }),
  queries: (page: number, q: string, status: string, signal?: AbortSignal) => request<QueryPage>(`/queries?${new URLSearchParams({ page: String(page), page_size: "20", q, status })}`, { signal }),
  query: (id: string, signal?: AbortSignal) => request<QueryHistoryItem>(`/queries/${encodeURIComponent(id)}`, { signal }),
  deleteQuery: (id: string) => request<void>(`/queries/${encodeURIComponent(id)}`, { method: "DELETE" }),
  audit: (signal?: AbortSignal) => request<{ items: AuditEntry[] }>("/audit?limit=50", { signal }),
};
