/**
 * 首页空状态组件
 * 介绍系统能力并给出分类示例问题，点击示例自动填入输入框
 */
import { ArrowUpRight, BarChart3, Flame, Lightbulb, Sparkles, TrendingUp, Users } from "lucide-react";

type EmptyStateProps = {
  examples: string[];
  onUseExample: (example: string) => void;
};

const FEATURE_TAGS = [
  { icon: TrendingUp, label: "GMV 与销售趋势", color: "text-emerald-700 bg-emerald-50 border-emerald-200/60" },
  { icon: Flame, label: "爆款商品排行", color: "text-amber-700 bg-amber-50 border-amber-200/60" },
  { icon: Users, label: "会员画像分析", color: "text-sky-700 bg-sky-50 border-sky-200/60" },
];

export function EmptyState({ examples, onUseExample }: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-8 animate-fade-in">
      {/* 头部微光引导 */}
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-moss-700 via-moss-600 to-teal-500 text-white shadow-glow">
          <BarChart3 className="h-7 w-7" aria-hidden="true" />
          <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] text-slate-900 ring-2 ring-white">
            <Sparkles className="h-2.5 w-2.5" />
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          今天想探索哪些数仓经营数据？
        </h1>
        <p className="mt-2.5 max-w-lg text-[14px] leading-6 text-slate-500">
          用自然的中文提问，Agent 会自主识别指标、下钻表结构、校验安全并实时生成报表与图表。
        </p>

        {/* 亮点功能标签 */}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {FEATURE_TAGS.map(({ icon: Icon, label, color }) => (
            <div
              key={label}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${color}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 示例问题网格 */}
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            快速灵感与热门提问
          </span>
          <span className="text-[11px] text-slate-400">点击自动填充</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {examples.map((example, idx) => (
            <button
              key={example}
              type="button"
              onClick={() => onUseExample(example)}
              className="group relative flex items-start justify-between gap-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-moss-500/40 hover:shadow-card-hover focus:outline-none focus:ring-2 focus:ring-moss-500/25"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-500 transition-colors group-hover:bg-moss-50 group-hover:text-moss-700">
                  {idx + 1}
                </span>
                <span className="text-[13px] font-medium leading-relaxed text-slate-700 transition-colors group-hover:text-slate-900">
                  {example}
                </span>
              </div>
              <ArrowUpRight
                className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-moss-600"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
