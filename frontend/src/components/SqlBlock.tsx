/**
 * SQL 展示组件 (B2B BI 风格)
 * 工业级高对比终端代码块、行号与精准格式化
 */
import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

export function SqlBlock({ sql }: { sql?: string }) {
  const [copied, setCopied] = useState(false);

  if (!sql) {
    return (
      <div className="p-8 text-center font-mono text-xs text-slate-400">
        [NO_QUERY_RECORDED] 本次执行未保留生成的 SQL。
      </div>
    );
  }

  const onCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = sql.trim().split("\n");

  return (
    <div className="bg-[#18181b] text-slate-100 font-mono text-xs">
      {/* 终端控制头 */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-[#121214] px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal className="h-3.5 w-3.5 text-brand-500" />
          <span>QUERY_CONSOLE // ANSI-SQL</span>
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-zinc-300 hover:bg-zinc-700 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? "COPIED" : "COPY"}</span>
        </button>
      </div>

      {/* SQL 视图与行号 */}
      <div className="max-h-[380px] overflow-auto p-3 leading-5">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-zinc-800/40">
                <td className="w-8 select-none pr-3 text-right text-[10px] text-zinc-600">
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
