/**
 * 查询结果表格组件
 * 按列类型渲染结果：数值列右对齐并格式化，表头吸顶，斑马纹与悬浮高亮，超出高度滚动
 */
import { Hash, Type } from "lucide-react";
import { cn } from "../lib/format";
import { formatNumber, parseNumber, type ColumnInfo, type Row } from "../lib/resultData";

function formatCell(value: unknown, column: ColumnInfo) {
  if (value === null || value === undefined || value === "") return "-";
  if (column.kind === "number") {
    const number = parseNumber(value);
    if (number !== null) return formatNumber(number);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ResultTable({ rows, columns }: { rows: Row[]; columns: ColumnInfo[] }) {
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
          <tr>
            <th
              scope="col"
              className="w-12 border-b border-slate-200 px-3 py-2.5 text-center font-mono text-[11px] font-semibold text-slate-400"
            >
              #
            </th>
            {columns.map((column) => (
              <th
                key={column.name}
                scope="col"
                className={cn(
                  "whitespace-nowrap border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600",
                  column.kind === "number" && "text-right",
                )}
              >
                <div
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    column.kind === "number" && "flex-row-reverse",
                  )}
                >
                  {column.kind === "number" ? (
                    <Hash className="h-3 w-3 text-slate-400" />
                  ) : (
                    <Type className="h-3 w-3 text-slate-400" />
                  )}
                  <span>{column.name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={cn(
                "transition-colors",
                rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                "hover:bg-teal-50/40",
              )}
            >
              <td className="border-b border-slate-100 px-3 py-2.5 text-center font-mono text-[11px] text-slate-400">
                {rowIndex + 1}
              </td>
              {columns.map((column) => (
                <td
                  key={column.name}
                  className={cn(
                    "whitespace-nowrap border-b border-slate-100 px-4 py-2.5 text-slate-700",
                    column.kind === "number"
                      ? "text-right font-mono text-[13px] tabular-nums font-medium text-slate-800"
                      : "text-[13px]",
                  )}
                >
                  {formatCell(row[column.name], column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
