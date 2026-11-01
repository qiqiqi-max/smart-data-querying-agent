/**
 * 聊天输入区组件
 * 悬浮微光质感、自适应增高输入框、状态胶囊与快捷键提示
 */
import { ArrowUp, CornerDownLeft, Square } from "lucide-react";
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
    <form onSubmit={submit} className="relative shrink-0">
      <div className="relative rounded-2xl border border-slate-200/90 bg-white shadow-floating transition-all duration-200 focus-within:border-moss-600/50 focus-within:ring-4 focus-within:ring-moss-500/10">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="提出你的业务问题，例如：统计 2025 年 3 月各商品品类的销量和销售额..."
          className="max-h-40 min-h-[52px] w-full resize-none bg-transparent px-4 py-3.5 text-[14px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
        />

        <div className="flex items-center justify-between border-t border-slate-100/80 px-3 py-2">
          {/* 左侧快捷提示 */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500">
              <CornerDownLeft className="h-2.5 w-2.5" /> Enter 发送
            </span>
            <span className="hidden sm:inline">· Shift+Enter 换行</span>
            <span className="hidden md:inline">· 支持自主 SQL 校验与纠错</span>
          </div>

          {/* 右侧发送 / 停止按钮 */}
          <button
            type={isStreaming ? "button" : "submit"}
            onClick={isStreaming ? onStop : undefined}
            disabled={!isStreaming && disabled}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
              isStreaming
                ? "bg-rose-600 hover:bg-rose-700 focus:ring-rose-400"
                : "bg-slate-900 hover:bg-slate-800 focus:ring-slate-400 shadow-sm",
            )}
            title={isStreaming ? "停止生成" : "发送提问"}
            aria-label={isStreaming ? "停止生成" : "发送提问"}
          >
            {isStreaming ? (
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
