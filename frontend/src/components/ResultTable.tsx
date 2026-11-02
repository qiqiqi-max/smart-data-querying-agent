/**
 * 查询结果表格组件 (B2B BI 风格)
 * 工业级致密排版、等宽网格线、类型徽章与清晰对齐
 */
import { Hash, Type } from "lucide-react";
import { cn } from "../lib/format";
import { formatNumber, parseNumber, type ColumnInfo, type Row } from "../lib/resultData";

function formatCell(value: unknown, column: ColumnInfo) {
  if (value === null || value === undefined || value === "") return <span className="text-slate-300">NULL</span>;
  if (column.kind === "number") {
    const number = parseNumber(value);
    if (number !== null) return formatNumber(number);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ResultTable({ rows, columns }: { rows: Row[]; columns: ColumnInfo[] }) {
  return (
    <div className="max-h-[460px] overflow-auto border-t border-slate-200">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-300">
          <tr>
            <th
              scope="col"
              className="w-10 border-r border-slate-200 px-2 py-2 text-center font-mono text-[10px] font-bold text-slate-500 uppercase"
            >
              #
            </th>
            {columns.map((column) => (
              <th
                key={column.name}
                scope="col"
                className={cn(
                  "border-r border-slate-200 px-3 py-2 font-mono text-[11px] font-bold text-slate-700",
                  column.kind === "number" && "text-right",
                )}
              >
                <div
                  className={cn(
                    "inline-flex items-center gap-1",
                    column.kind === "number" && "flex-row-reverse",
                  )}
                >
                  <span className="text-[10px] text-slate-400 font-mono">
                    [{column.kind === "number" ? "NUM" : "STR"}]
                  </span>
                  <span>{column.name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 font-mono text-xs">
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={cn(
                "transition hover:bg-brand-50/40",
                rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50/50",
              )}
            >
              <td className="border-r border-slate-200 px-2 py-1.5 text-center text-[10px] text-slate-400 select-none">
                {rowIndex + 1}
              </td>
              {columns.map((column) => (
                <td
                  key={column.name}
                  className={cn(
                    "border-r border-slate-200 px-3 py-1.5 text-slate-800 whitespace-nowrap",
                    column.kind === "number"
                      ? "text-right tabular-nums font-semibold text-slate-900"
                      : "font-sans text-xs",
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
