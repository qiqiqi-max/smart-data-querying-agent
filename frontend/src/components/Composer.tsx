/**
 * 聊天输入区组件
 * 处理问题输入、发送和停止当前流式请求；输入框随内容自动增高
 */
import { ArrowUp, Square } from "lucide-react";
import { useLayoutEffect, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { cn } from "../lib/format";

type ComposerProps = {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
};

export function Composer({
  value,
  disabled,
  isStreaming,
  inputRef,
  onChange,
  onSubmit,
  onStop,
}: ComposerProps) {
  // 先重置高度再取 scrollHeight，删减文字时输入框也能缩回去；最大高度由 max-h 限制
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, inputRef]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法选词时按回车不应发送
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  };

  return (
    <form onSubmit={submit} className="shrink-0 px-4 pb-4 pt-2 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-card transition focus-within:border-moss/40 focus-within:ring-2 focus-within:ring-moss/15">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="例如：统计 2025 年第一季度各大区的 GMV"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            type={isStreaming ? "button" : "submit"}
            onClick={isStreaming ? onStop : undefined}
            disabled={!isStreaming && disabled}
            className={cn(
              "mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition focus:outline-none focus:ring-2 focus:ring-moss/30 focus:ring-offset-2",
              isStreaming
                ? "bg-tomato hover:bg-tomato/90"
                : "bg-slate-900 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300",
            )}
            title={isStreaming ? "停止" : "发送"}
            aria-label={isStreaming ? "停止" : "发送"}
          >
            {isStreaming ? (
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="mt-1.5 text-center text-[11px] text-slate-400">
          Enter 发送 · Shift + Enter 换行 · 结果最多返回 1000 行
        </div>
      </div>
    </form>
  );
}
