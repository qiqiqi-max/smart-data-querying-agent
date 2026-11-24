/**
 * 首页空状态组件 (B2B BI 驾驶舱风格)
 * 数据集元信息卡片、指标主题看板与预置分析模版
 */
import {
  ArrowRight,
  Flame,
  Layers,
  LineChart,
  TableProperties,
  TrendingUp,
  Users,
} from "lucide-react";

type EmptyStateProps = {
  examples: string[];
  onUseExample: (example: string) => void;
};

// 数仓核心业务主题
const DOMAINS = [
  {
    icon: TrendingUp,
    name: "交易与 GMV",
    desc: "大区业绩、销售额达成、环比变化",
    sample: "统计 2025 年第一季度各大区的 GMV，并按 GMV 从高到低排序",
  },
  {
    icon: Flame,
    name: "品类与商品",
    desc: "各品类销量、TOP5 爆品排行",
    sample: "统计 2025 年 3 月各商品品类的销量和销售额",
  },
  {
    icon: Users,
    name: "用户与会员",
    desc: "会员等级分布、客单价与复购分析",
    sample: "按会员等级统计 2025 年第一季度的订单数和销售额",
  },
  {
    icon: LineChart,
    name: "区域透视",
    desc: "重点省市销量拆解、区域下钻",
    sample: "查询华东地区 2025 年第一季度销售额最高的前 5 个商品",
  },
];

export function EmptyState({ examples, onUseExample }: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center px-4 py-8 sm:px-8 lg:py-10">
      {/* 顶部数仓仪表盘控制台标头 */}
      <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-subtle sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 border border-brand-200">
              <TableProperties className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-snug text-slate-900 sm:text-2xl">
                电商数据，一问即查
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                用自然语言描述问题，查看数据、图表和生成的 SQL。
              </p>
            </div>
          </div>

        </div>

        {/* 数仓指标元数据概览 */}
        <div className="grid grid-cols-2 gap-3 pt-5 xl:grid-cols-4">
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-sm text-slate-600 font-bold">结果查看</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">表格与图表</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-sm text-slate-600 font-bold">查询追踪</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">SQL 与执行步骤</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-sm text-slate-600 font-bold">分析留存</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">历史与 CSV 导出</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-sm text-slate-600 font-bold">查询范围</div>
            <div className="mt-1 text-sm font-semibold text-emerald-700">只读数据查询</div>
          </div>
        </div>
      </div>

      {/* 核心业务主题模板矩阵 */}
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Layers className="h-3.5 w-3.5 text-slate-600" />
            业务分析场景
          </h2>
          <span className="text-sm text-slate-600">选一个问题，修改后即可查询</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {DOMAINS.map((domain) => {
            const Icon = domain.icon;
            return (
              <button
                key={domain.name}
                type="button"
                onClick={() => onUseExample(domain.sample)}
                className="group flex flex-col justify-between rounded-xl border border-slate-300 bg-white p-5 text-left shadow-subtle transition hover:border-brand-500 hover:bg-brand-50/30 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-700 group-hover:bg-brand-50 group-hover:text-brand-700">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-base font-semibold text-slate-900">
                        {domain.name}
                      </span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-600" />
                  </div>
                  <p className="mt-1.5 text-sm text-slate-600">{domain.desc}</p>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800 group-hover:border-brand-200">
                  {domain.sample}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
