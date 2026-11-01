/**
 * SQL 展示组件
 * 用等宽代码块展示智能体最终执行的 SQL
 */
export function SqlBlock({ sql }: { sql?: string }) {
  if (!sql) {
    return (
      <div className="px-4 py-8 text-center text-sm text-slate-500">
        这条记录没有保存 SQL，重新查询一次即可看到。
      </div>
    );
  }

  return (
    <pre className="max-h-[360px] overflow-auto bg-slate-950 px-4 py-4 font-mono text-[13px] leading-6 text-slate-100">
      <code className="whitespace-pre-wrap break-words">{sql}</code>
    </pre>
  );
}
