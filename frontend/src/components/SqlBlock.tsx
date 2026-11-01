/**
 * SQL 展示组件
 * 模拟 IDE 终端风格，带视窗头部、行号与高对比度排版
 */
import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

export function SqlBlock({ sql }: { sql?: string }) {
  const [copied, setCopied] = useState(false);

  if (!sql) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-sm text-slate-400">
        <Terminal className="h-8 w-8 text-slate-300 mb-2" />
        <p>本次查询未记录 SQL，重新发起一次查询即可查看。</p>
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
    <div className="overflow-hidden bg-[#0d1117] text-slate-100">
      {/* 终端头部装饰条 */}
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          </div>
          <span className="ml-2 font-mono text-[11px] text-slate-400">
            executed_query.sql
          </span>
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>

      {/* SQL 视图与行号 */}
      <div className="max-h-[380px] overflow-auto p-4 font-mono text-[13px] leading-6">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-white/[0.04]">
                <td className="w-8 select-none pr-4 text-right text-[11px] text-slate-600">
                  {idx + 1}
                </td>
                <td className="whitespace-pre-wrap break-all text-slate-200">
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
