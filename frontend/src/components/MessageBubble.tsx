/**
 * 聊天消息组件
 * 用户问题显示为右侧气泡；智能体回答显示为卡片，包含摘要、执行轨迹和结果面板
 */
import { Bot } from "lucide-react";
import { cn, formatTime } from "../lib/format";
import type { ChatMessage } from "../types/agent";
import { ResultPanel } from "./ResultPanel";
import { SqlBlock } from "./SqlBlock";
import { StepRail } from "./StepRail";

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <article className="flex flex-col items-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-[15px] leading-7 text-white">
          {message.content}
        </div>
        <div className="mt-1 pr-1 text-[11px] text-slate-400">{formatTime(message.createdAt)}</div>
      </article>
    );
  }

  const failedWithSql = message.status === "error" && message.sql && message.result === undefined;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-card sm:px-5">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-moss/10 text-moss">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className="text-sm font-medium text-slate-900">问数助手</span>
        <span className="ml-auto text-[11px] text-slate-400">{formatTime(message.createdAt)}</span>
      </div>

      <p
        className={cn(
          "mt-3 whitespace-pre-wrap text-[15px] leading-7",
          message.status === "stopped" ? "text-slate-500" : "text-slate-800",
        )}
      >
        {message.content}
      </p>

      {message.error && (
        <div className="mt-3 rounded-lg border border-tomato/20 bg-tomato/5 px-3 py-2 text-sm text-tomato">
          {message.error}
        </div>
      )}

      <StepRail
        steps={message.steps}
        status={message.status}
        startedAt={message.createdAt}
        finishedAt={message.finishedAt}
      />

      {message.result !== undefined && (
        <ResultPanel
          data={message.result}
          truncated={message.truncated}
          sql={message.sql}
          query={message.query}
        />
      )}

      {failedWithSql && (
        <details className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            查看最后一次生成的 SQL
          </summary>
          <SqlBlock sql={message.sql} />
        </details>
      )}
    </article>
  );
}
