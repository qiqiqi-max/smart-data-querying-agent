/**
 * 首页空状态组件
 * 用更克制的工作台式布局展示品牌和示例问题
 */
import { BarChart3, Sparkles, Database, LineChart } from "lucide-react";

type EmptyStateProps = {
  examples: string[];
  onUseExample: (example: string) => void;
};

export function EmptyState({ examples, onUseExample }: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center px-4 py-10">
      <div className="border border-slate-200 bg-white/90 p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)] lg:p-8">
        <div className="inline-flex items-center gap-2 border border-moss/20 bg-moss/10 px-3 py-1.5 text-sm font-semibold text-moss">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Smart Data Querying Agent
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            MySQL
          </span>
          <span className="inline-flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
            LangGraph
          </span>
          <span className="inline-flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
            FastAPI
          </span>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onUseExample(example)}
              className="min-h-20 border border-slate-200 bg-slate-50/80 px-4 py-4 text-left text-[15px] leading-6 text-slate-800 transition hover:-translate-y-0.5 hover:border-moss/30 hover:bg-white focus:outline-none focus:ring-2 focus:ring-moss/25"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
