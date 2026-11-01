/**
 * 折线图组件
 * 用 SVG 绘制按时间排列的一条或多条折线，缺失的点断开不连线，悬停查看各系列数值
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  formatCompact,
  formatNumber,
  sortTemporalLabels,
  type ChartSeries,
} from "../lib/resultData";

export const SERIES_COLORS = ["#0f766e", "#0284c7", "#b45309", "#7c3aed", "#be123c", "#475569"];

const HEIGHT = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 56 };

// 把坐标轴刻度取成 1、2、5 的整倍数，读数更直观
function niceTicks(min: number, max: number, count = 4) {
  const [low, high] = min === max ? [min - 1, max + 1] : [min, max];
  const rough = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.floor(low / step) * step; value <= high + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

function useElementWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function LineChart({ series }: { series: ChartSeries[] }) {
  const [containerRef, width] = useElementWidth();
  const [hover, setHover] = useState<number | null>(null);

  const labels = sortTemporalLabels(series.flatMap((item) => item.points.map((point) => point.label)));
  const lookup = series.map((item) => new Map(item.points.map((point) => [point.label, point.value])));
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  if (values.length === 0) return null;

  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const [yMin, yMax] = [ticks[0], ticks[ticks.length - 1]];
  const innerWidth = Math.max(width - PAD.left - PAD.right, 1);
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (labels.length === 1 ? innerWidth / 2 : (index * innerWidth) / (labels.length - 1));
  const y = (value: number) => PAD.top + innerHeight * (1 - (value - yMin) / (yMax - yMin || 1));
  // 横轴标签太密时隔几个显示一个，每个标签大约占 72px
  const labelStep = Math.max(1, Math.ceil(labels.length / Math.max(Math.floor(innerWidth / 72), 1)));
  const color = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

  const paths = lookup.map((map) => {
    const segments: string[] = [];
    let current = "";
    labels.forEach((label, index) => {
      const value = map.get(label);
      if (value === undefined) {
        if (current) segments.push(current);
        current = "";
        return;
      }
      current += `${current ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    });
    if (current) segments.push(current);
    return segments.join(" ");
  });

  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    setHover(Math.round(ratio * (labels.length - 1)));
  };

  return (
    <div ref={containerRef} className="relative">
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label="折线图">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" />
              <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px]">
                {formatCompact(tick)}
              </text>
            </g>
          ))}
          {labels.map((label, index) =>
            index % labelStep === 0 ? (
              <text key={label} x={x(index)} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">
                {label}
              </text>
            ) : null,
          )}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerHeight} stroke="#94a3b8" strokeDasharray="3 3" />
          )}
          {paths.map((d, index) => (
            <path key={index} d={d} fill="none" stroke={color(index)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {labels.length <= 31 &&
            lookup.map((map, seriesIndex) =>
              labels.map((label, index) => {
                const value = map.get(label);
                if (value === undefined) return null;
                return (
                  <circle key={`${seriesIndex}-${label}`} cx={x(index)} cy={y(value)} r={hover === index ? 4 : 2.5} fill="#fff" stroke={color(seriesIndex)} strokeWidth={2} />
                );
              }),
            )}
          <rect x={PAD.left} y={PAD.top} width={innerWidth} height={innerHeight} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      )}

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[128px] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-panel"
          style={{ left: Math.min(Math.max(x(hover), 72), width - 72) }}
        >
          <div className="font-medium text-slate-900">{labels[hover]}</div>
          {series.map((item, index) => {
            const value = lookup[index].get(labels[hover]);
            return (
              <div key={item.name} className="mt-1 flex items-center justify-between gap-3 text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: color(index) }} />
                  {item.name}
                </span>
                <span className="font-mono tabular-nums text-slate-900">
                  {value === undefined ? "-" : formatNumber(value)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {series.map((item, index) => (
            <span key={item.name} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: color(index) }} />
              {item.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
