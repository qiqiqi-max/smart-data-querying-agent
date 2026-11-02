/**
 * 聊天消息组件 (B2B BI 风格)
 * 工业结构化卡片、指令摘要、节点追踪与多维报表面板
 */
import { Check, Copy, Database, Terminal, User } from "lucide-react";
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
      <article className="group flex flex-col items-end">
        <div className="flex items-center gap-1.5 max-w-[90%] sm:max-w-[85%]">
          <button
            type="button"
            onClick={copyPrompt}
            className="rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100"
            title="复制指令"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          </button>
          <div className="rounded border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-sans text-slate-100 shadow-subtle">
            <div className="flex items-center gap-1.5 border-b border-slate-700/80 pb-1 mb-1 font-mono text-[10px] text-slate-400">
              <User className="h-2.5 w-2.5" />
              <span>USER_PROMPT //</span>
              <span>{formatTime(message.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </article>
    );
  }

  const failedWithSql =
    message.status === "error" && message.sql && message.result === undefined;

  return (
    <article className="rounded border border-slate-200 bg-white p-3.5 shadow-subtle">
      {/* 消息标头 */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-50 text-brand-700 font-bold text-[10px] border border-brand-200">
            AG
          </span>
          <span className="font-bold text-slate-800">AGENT_RESPONSE</span>
          <span className="rounded bg-slate-100 px-1 py-0.2 text-[10px] text-slate-500">
            TEXT2SQL
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          {formatTime(message.createdAt)}
        </span>
      </div>

      {/* 结果摘要 */}
      <div
        className={cn(
          "mt-2.5 text-xs leading-relaxed",
          message.status === "stopped" ? "text-slate-500 italic" : "text-slate-800",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>

      {/* 错误提示 */}
      {message.error && (
        <div className="mt-2.5 rounded border border-rose-200 bg-rose-50 p-2.5 font-mono text-xs text-rose-700">
          <span className="font-bold">[ERROR] </span>
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
          <summary className="cursor-pointer px-3 py-1.5 font-mono text-xs text-slate-600 hover:bg-slate-100">
            [INSPECT] 查看异常时生成的 SQL
          </summary>
          <SqlBlock sql={message.sql} />
        </details>
      )}
    </article>
  );
}
