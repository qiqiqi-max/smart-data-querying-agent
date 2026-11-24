/**
 * SQL 展示组件 (B2B BI 风格)
 * 工业级高对比终端代码块、行号与精准格式化
 */
import { Check, Copy, Terminal } from "lucide-react";
import { useCopy } from "../lib/browser";

export function SqlBlock({ sql }: { sql?: string }) {
  const { copied, copy } = useCopy();

  if (!sql) {
    return (
      <div className="p-8 text-center font-mono text-sm text-slate-600">
        本次执行未保留生成的 SQL。
      </div>
    );
  }

  const onCopy = () => void copy(sql);

  const lines = sql.trim().split("\n");

  return (
    <div className="bg-[#18181b] text-slate-100 font-mono text-sm">
      {/* 终端控制头 */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-[#121214] px-3 py-1.5 text-sm">
        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal className="h-3.5 w-3.5 text-brand-500" />
          <span>执行 SQL</span>
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="flex min-h-11 items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-zinc-200 hover:bg-zinc-700 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>

      {/* SQL 视图与行号 */}
      <div className="max-h-[420px] overflow-auto p-4 leading-7">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-zinc-800/40">
                <td className="w-8 select-none pr-3 text-right text-sm text-zinc-400">
                  {idx + 1}
                </td>
                <td className="whitespace-pre-wrap break-all text-emerald-300">
                  {line || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
