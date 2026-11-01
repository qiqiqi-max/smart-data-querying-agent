/**
 * 聊天消息组件
 * 用户问题显示为右侧气泡；智能体回答显示为卡片，包含摘要、执行轨迹和结果面板
 */
import { Bot, CheckCircle2, Copy } from "lucide-react";
import { useState } from "react";
import { cn, formatTime } from "../lib/format";
import type { ChatMessage } from "../types/agent";
import { ResultPanel } from "./ResultPanel";
import { SqlBlock } from "./SqlBlock";
import { StepRail } from "./StepRail";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);

  const copyPrompt = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (message.role === "user") {
    return (
      <article className="group flex flex-col items-end animate-slide-up">
        <div className="flex items-end gap-2 max-w-[88%] sm:max-w-[80%]">
          <button
            type="button"
            onClick={copyPrompt}
            className="mb-1 rounded-lg p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
            title="复制问题"
          >
            {copied ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <div className="relative overflow-hidden rounded-2xl rounded-br-sm bg-gradient-to-tr from-slate-900 to-slate-800 px-4 py-3 text-[14px] leading-relaxed text-white shadow-card">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1.5 pr-2 text-[11px] text-slate-400">
          <span>{formatTime(message.createdAt)}</span>
        </div>
      </article>
    );
  }

  const failedWithSql =
    message.status === "error" && message.sql && message.result === undefined;

  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-4 sm:p-5 shadow-card backdrop-blur-sm animate-slide-up transition-shadow duration-200 hover:shadow-card-hover">
      {/* 头部 Agent 标识 */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-moss-700 to-teal-500 text-white shadow-sm ring-1 ring-moss-700/20">
            <Bot className="h-4 w-4" aria-hidden="true" />
            {message.status === "streaming" && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" />
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold text-slate-900">
                问数智能体
              </span>
              <span className="rounded bg-slate-100 px-1 py-0.2 text-[10px] font-mono font-medium text-slate-500">
                SQL-Agent
              </span>
            </div>
          </div>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          {formatTime(message.createdAt)}
        </span>
      </div>

      {/* 消息文本描述 */}
      <div
        className={cn(
          "mt-3 text-[14px] leading-relaxed",
          message.status === "stopped" ? "text-slate-500 italic" : "text-slate-800",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>

      {/* 错误提示 */}
      {message.error && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-200/80 bg-rose-50/60 p-3 text-[13px] leading-relaxed text-rose-700">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-200 text-rose-800 text-[10px] font-bold">
            !
          </span>
          <div className="flex-1 break-words">{message.error}</div>
        </div>
      )}

      {/* 执行轨迹时间线 */}
      <StepRail
        steps={message.steps}
        status={message.status}
        startedAt={message.createdAt}
        finishedAt={message.finishedAt}
      />

      {/* 查询结果大屏面板 */}
      {message.result !== undefined && (
        <ResultPanel
          data={message.result}
          truncated={message.truncated}
          sql={message.sql}
          query={message.query}
        />
      )}

      {/* 失败时查看生成的 SQL */}
      {failedWithSql && (
        <details className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/50">
          <summary className="cursor-pointer select-none px-3.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100/70">
            查看异常前生成的 SQL 语句
          </summary>
          <SqlBlock sql={message.sql} />
        </details>
      )}
    </article>
  );
}
