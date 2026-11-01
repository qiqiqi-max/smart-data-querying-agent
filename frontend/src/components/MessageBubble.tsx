/**
 * 聊天消息气泡组件
 * 组合展示用户问题、智能体回复、执行流程和结果表格
 */
import { Bot, Copy, UserRound } from "lucide-react";
import { ResultChart } from "./ResultChart";
import { ResultTable } from "./ResultTable";
import { StepRail } from "./StepRail";
import { cn, formatTime, toClipboardText } from "../lib/format";
import type { ChatMessage } from "../types/agent";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  const copy = async () => {
    const text = message.result ? toClipboardText(message.result) : message.content;
    await navigator.clipboard.writeText(text);
  };

  return (
    <article className={cn("group flex gap-3", isUser && "justify-end")}>
      {!isUser && (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-900">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>
      )}

      <div className={cn("max-w-[920px] flex-1", isUser && "flex max-w-[760px] justify-end")}>
        <div
          className={cn(
            "relative max-w-full border px-4 py-4",
            isUser
              ? "border-slate-900/80 bg-slate-900 text-white"
              : "border-slate-200 bg-white/90 text-slate-900",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "mb-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                  isUser ? "border-white/15 text-white/65" : "border-slate-200 text-slate-500",
                )}
              >
                {isUser ? "you" : "agent"}
              </div>
              <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
            </div>
            {!isUser && message.status !== "streaming" && (
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded-full p-1.5 text-slate-400 opacity-0 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 focus:ring-2 focus:ring-moss/30 group-hover:opacity-100"
                title="复制"
                aria-label="复制"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {message.error && (
            <div className="mt-3 border border-tomato/20 bg-tomato/10 px-3 py-2 text-sm text-tomato">
              {message.error}
            </div>
          )}

          {!isUser && <StepRail steps={message.steps} stopped={message.status === "stopped"} />}
          {!isUser && message.result !== undefined && <ResultChart data={message.result} />}
          {!isUser && message.result !== undefined && (
            <ResultTable data={message.result} truncated={message.truncated} />
          )}

          <div
            className={cn(
              "mt-3 text-xs",
              isUser ? "text-white/55" : "text-slate-400",
            )}
          >
            {formatTime(message.createdAt)}
          </div>
        </div>
      </div>

      {isUser && (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-moss text-white">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
    </article>
  );
}
