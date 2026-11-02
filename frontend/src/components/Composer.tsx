/**
 * 聊天输入区组件 (B2B BI 数据控制台风格)
 * 工业质感输入框、SQL 提示条与执行按键
 */
import { CornerDownLeft, Play, Square, Terminal } from "lucide-react";
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
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value, inputRef]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  };

  return (
    <form onSubmit={submit} className="relative">
      <div className="rounded border border-slate-300 bg-white shadow-subtle transition focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-500">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="输入业务分析指令，例如：统计 2025 年 3 月各商品品类的销量和销售额..."
          className="max-h-36 min-h-[46px] w-full resize-none bg-transparent px-3 py-2.5 text-xs font-sans text-slate-900 outline-none placeholder:text-slate-400"
        />

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-3 py-1.5 font-mono text-[11px]">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="flex items-center gap-1 rounded bg-slate-200/70 px-1.5 py-0.2 text-[10px] text-slate-600 font-bold">
              <CornerDownLeft className="h-2.5 w-2.5" /> ENTER
            </span>
            <span className="hidden sm:inline">EXECUTE</span>
            <span className="hidden sm:inline">· SHIFT+ENTER: NEWLINE</span>
          </div>

          <button
            type={isStreaming ? "button" : "submit"}
            onClick={isStreaming ? onStop : undefined}
            disabled={!isStreaming && disabled}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded px-3 font-mono text-xs font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400",
              isStreaming
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-brand-600 hover:bg-brand-700 shadow-subtle",
            )}
          >
            {isStreaming ? (
              <>
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>ABORT</span>
              </>
            ) : (
              <>
                <Play className="h-2.5 w-2.5 fill-current" />
                <span>RUN_QUERY</span>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
