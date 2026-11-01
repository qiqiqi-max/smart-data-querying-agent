/**
 * 查询结果表格组件
 * 按列类型渲染结果：数值列右对齐并格式化，表头吸顶，超出高度滚动
 */
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
    <div className="max-h-[360px] overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.name}
                scope="col"
                className={cn(
                  "whitespace-nowrap border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-500",
                  column.kind === "number" && "text-right",
                )}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="transition hover:bg-slate-50">
              {columns.map((column) => (
                <td
                  key={column.name}
                  className={cn(
                    "whitespace-nowrap border-b border-slate-100 px-4 py-2.5 text-slate-700",
                    column.kind === "number" && "text-right font-mono text-[13px] tabular-nums",
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
