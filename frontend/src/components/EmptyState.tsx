/**
 * 首页空状态组件
 * 介绍能做什么并给出示例问题，点击示例会填入输入框，确认后再发送
 */
import { ArrowUpRight, BarChart3 } from "lucide-react";

type EmptyStateProps = {
  examples: string[];
  onUseExample: (example: string) => void;
};

export function EmptyState({ examples, onUseExample }: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center py-10">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-moss/10 text-moss">
        <BarChart3 className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-slate-900">想了解哪些经营数据？</h1>
      <p className="mt-2 text-[15px] leading-7 text-slate-500">
        用一句话描述问题，助手会查找相关的表和指标，生成并校验 SQL，再从数仓返回结果和图表。
      </p>

      <div className="mt-8 text-xs font-medium text-slate-500">试试这些问题</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onUseExample(example)}
            className="group flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left text-sm leading-6 text-slate-700 shadow-card transition hover:border-moss/40 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-moss/25"
          >
            {example}
            <ArrowUpRight
              className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-moss"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
