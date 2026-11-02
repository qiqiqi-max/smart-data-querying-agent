/**
 * 首页空状态组件 (B2B BI 驾驶舱风格)
 * 数据集元信息卡片、指标主题看板与预置分析模版
 */
import {
  ArrowRight,
  Database,
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
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center py-6">
      {/* 顶部数仓仪表盘控制台标头 */}
      <div className="border border-slate-200 bg-white p-5 rounded-lg shadow-subtle">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-brand-50 text-brand-700 border border-brand-200">
              <TableProperties className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">
                电商数仓智能分析引擎 (Text2SQL Agent)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                基于自然语言自动映射数仓元数据，生成经过安全校验的标准 SQL 并输出多维看板
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200/80">
            <Database className="h-3.5 w-3.5 text-brand-600" />
            <span>SCHEMA: dw_ecommerce</span>
          </div>
        </div>

        {/* 数仓指标元数据概览 */}
        <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-4 font-mono">
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-[10px] text-slate-400 font-bold">FACT_TABLES</div>
            <div className="mt-1 text-sm font-bold text-slate-800">dwd_order_detail</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-[10px] text-slate-400 font-bold">DIM_TABLES</div>
            <div className="mt-1 text-sm font-bold text-slate-800">dim_region, dim_item</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-[10px] text-slate-400 font-bold">PRIMARY_METRICS</div>
            <div className="mt-1 text-sm font-bold text-slate-800">GMV, 销量, 订单量</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-[10px] text-slate-400 font-bold">SAFETY_GUARD</div>
            <div className="mt-1 text-sm font-bold text-emerald-600">LIMIT ≤ 1000</div>
          </div>
        </div>
      </div>

      {/* 核心业务主题模板矩阵 */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-slate-400" />
            业务分析场景模版 (ANALYTICAL_SCENARIOS)
          </span>
          <span className="text-[11px] text-slate-400">点击模版载入指令</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {DOMAINS.map((domain) => {
            const Icon = domain.icon;
            return (
              <button
                key={domain.name}
                type="button"
                onClick={() => onUseExample(domain.sample)}
                className="group flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left shadow-subtle transition hover:border-brand-500/50 hover:bg-slate-50/80 hover:shadow-card focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-700 group-hover:bg-brand-50 group-hover:text-brand-700">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-bold text-slate-900">
                        {domain.name}
                      </span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-600" />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">{domain.desc}</p>
                </div>

                <div className="mt-3 rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-600 border border-slate-100 group-hover:border-brand-100 group-hover:bg-brand-50/30">
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
