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
  // 实际执行的 SQL
  sql?: string;
};

export type ErrorEvent = {
  type: "error";
  message: string;
  // SQL 校验多次失败时带上最后一次的 SQL
  sql?: string | null;
};

export type AgentEvent = ProgressEvent | ResultEvent | ErrorEvent;

export type StepState = {
  step: string;
  status: ProgressStatus;
  // 第一次收到该步骤事件的时间，和 updatedAt 一起算出步骤耗时
  startedAt: number;
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  // 回答结束的时间，用来计算执行耗时；历史记录打开时没有该值
  finishedAt?: number;
  status?: "streaming" | "done" | "error" | "stopped";
  steps?: StepState[];
  result?: unknown;
  truncated?: boolean;
  sql?: string;
  // 回答对应的用户问题，用于导出文件名
  query?: string;
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
  sql?: string;
};

export type QueryHistoryItem = {
  id: string;
  query: string;
  status: RunStatus;
  summary: string | null;
  result: unknown;
  row_count: number;
  error: string | null;
  // 旧记录没有保存 SQL，值为 null
  sql?: string | null;
  created_at: string;
  updated_at: string;
};
