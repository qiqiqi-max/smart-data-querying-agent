/**
 * 通用格式化工具
 * 提供 className 合并、时间格式化和查询结果文本化等通用工具函数
 */
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

// 与后端 app/services/result_summary.py 的摘要文案保持一致
export function summarizeResult(data: unknown, truncated = false) {
  if (Array.isArray(data)) {
    if (data.length === 0) return "查询完成，结果为空。";
    return truncated
      ? `查询完成，仅返回前 ${data.length} 行结果。`
      : `查询完成，共 ${data.length} 行结果。`;
  }

  if (data && typeof data === "object") {
    return "查询完成，已返回结构化结果。";
  }

  if (data === null || data === undefined || data === "") {
    return "查询完成，结果为空。";
  }

  return `查询完成：${String(data)}`;
}

// 历史记录不单独保存截断标记，通过摘要文案还原
export function isTruncatedSummary(summary: string | null | undefined) {
  return Boolean(summary?.startsWith("查询完成，仅返回前 "));
}

export function countResultRows(data: unknown) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return 1;
  if (data === null || data === undefined || data === "") return 0;
  return 1;
}

export function toClipboardText(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
