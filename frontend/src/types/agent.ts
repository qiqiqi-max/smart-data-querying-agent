/**
 * 智能体类型定义
 * 定义问数智能体前端使用的 SSE 事件、流程步骤和聊天消息类型
 */
export type ProgressStatus = "running" | "success" | "error";

export type ProgressEvent = {
  type: "progress";
  step: string;
  status: ProgressStatus;
};

export type ResultEvent = {
  type: "result";
  data: unknown;
  // 结果超过后端行数上限被截断时为 true，旧版后端不返回该字段
  truncated?: boolean;
};

export type ErrorEvent = {
  type: "error";
  message: string;
};

export type AgentEvent = ProgressEvent | ResultEvent | ErrorEvent;

export type StepState = {
  step: string;
  status: ProgressStatus;
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status?: "streaming" | "done" | "error" | "stopped";
  steps?: StepState[];
  result?: unknown;
  truncated?: boolean;
  error?: string;
};

export type RunStatus = "running" | "done" | "error" | "stopped";

export type RunSummary = {
  id: string;
  query: string;
  status: RunStatus;
  summary: string;
  createdAt: number;
  updatedAt: number;
  rows?: number;
  activeStep?: string;
  error?: string;
  result?: unknown;
};

export type QueryHistoryItem = {
  id: string;
  query: string;
  status: RunStatus;
  summary: string | null;
  result: unknown;
  row_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};
