/**
 * 聊天消息组件 (B2B BI 风格)
 * 工业结构化卡片、指令摘要、节点追踪与多维报表面板
 */
import { Check, Copy, User } from "lucide-react";
import { useCopy } from "../lib/browser";
import { cn, formatTime } from "../lib/format";
import type { ChatMessage } from "../types/agent";
import { ResultPanel } from "./ResultPanel";
import { SqlBlock } from "./SqlBlock";
import { StepRail } from "./StepRail";
import { AssessmentReply } from "./AssessmentReply";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const { copied, copy } = useCopy();
  const copyPrompt = () => void copy(message.content);

  if (message.role === "user") {
    return (
      <article className="group flex flex-col items-end">
        <div className="flex min-w-0 max-w-full items-center gap-2 sm:max-w-[85%]">
          <button
            type="button"
            onClick={copyPrompt}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
            title="复制指令"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          </button>
          <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-100 shadow-subtle">
            <div className="mb-2 flex items-center gap-2 border-b border-slate-600 pb-2 text-sm text-slate-300">
              <User className="h-2.5 w-2.5" />
              <span>我的问题</span>
              <span>{formatTime(message.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        </div>
      </article>
    );
  }

  const failedWithSql =
    message.status === "error" && message.sql && message.result === undefined;

  return (
    <article className="rounded-xl border border-slate-300 bg-white p-3 shadow-subtle sm:p-5">
      {/* 消息标头 */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 font-sans text-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700 font-bold text-sm border border-brand-200">
            AI
          </span>
          <span className="font-semibold text-slate-900">{message.response ? "查询回复" : "分析结果"}</span>
        </div>
        <span className="text-sm text-slate-600">
          {formatTime(message.createdAt)}
        </span>
      </div>

      {/* 结果摘要 */}
      {message.response ? <AssessmentReply response={message.response} /> : <div
        className={cn(
          "mt-2.5 text-sm leading-relaxed",
          message.status === "stopped" ? "text-slate-600 italic" : "text-slate-800",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>}

      {/* 错误提示 */}
      {message.error && (
        <div className="mt-2.5 rounded border border-rose-200 bg-rose-50 p-2.5 font-sans text-sm text-rose-700">
          <span className="font-bold">查询失败：</span>
          <span>{message.error}</span>
        </div>
      )}

      {/* 执行轨迹时间线 */}
      <StepRail
        steps={message.steps}
        status={message.status}
        startedAt={message.createdAt}
        finishedAt={message.finishedAt}
      />

      {/* 查询结果报表面板 */}
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
        <details className="mt-2.5 rounded border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-1.5 font-sans text-sm text-slate-600 hover:bg-slate-100">
            查看异常时生成的 SQL
          </summary>
          <SqlBlock sql={message.sql} />
        </details>
      )}
    </article>
  );
}
