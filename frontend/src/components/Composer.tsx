/**
 * 聊天输入区组件 (B2B BI 数据控制台风格)
 * 工业质感输入框、SQL 提示条与执行按键
 */
import { CornerDownLeft, Play, Square } from "lucide-react";
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
  isClarifying?: boolean;
};

export function Composer({
  value,
  disabled,
  isStreaming,
  inputRef,
  onChange,
  onSubmit,
  onStop,
  isClarifying = false,
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
    <form onSubmit={submit} className="query-composer relative">
      <label htmlFor="query-input" className="mb-2 block text-sm font-semibold text-slate-800">{isClarifying ? "补充这次分析的信息" : "想了解哪些数据？"}</label>
      {isClarifying && <p className="mb-2 text-sm text-slate-600">这条补充会接着上一条问题分析。要提新问题，请新建分析。</p>}
      <div className="rounded-xl border border-slate-300 bg-white shadow-subtle transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15">
        <textarea
          id="query-input"
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={500}
          aria-describedby="query-input-hint"
          placeholder={isClarifying ? "补充上方问题，例如：本月销售额，按地区汇总" : "例如：统计 2025 年 3 月各商品品类的销量和销售额"}
          className="block max-h-40 min-h-[64px] w-full resize-none rounded-t-xl border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-600"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-sm">
          <div id="query-input-hint" className="flex items-center gap-2 text-slate-600">
            <span className="flex items-center gap-1 rounded bg-slate-200/70 px-1.5 py-0.5 text-sm text-slate-600 font-bold">
              <CornerDownLeft className="h-4 w-4" /> Enter
            </span>
            <span className="hidden sm:inline">发送</span>
            <span className="hidden md:inline">· Shift + Enter 换行</span>
          </div>

          <button
            type={isStreaming ? "button" : "submit"}
            onClick={isStreaming ? onStop : undefined}
            disabled={!isStreaming && disabled}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600",
              isStreaming
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-brand-600 hover:bg-brand-700 shadow-subtle",
            )}
          >
            {isStreaming ? (
              <>
                <Square className="h-4 w-4 fill-current" />
                <span>停止查询</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                <span>{isClarifying ? "提交补充" : "开始查询"}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
