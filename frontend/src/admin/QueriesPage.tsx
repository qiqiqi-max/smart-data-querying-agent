import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ResultPanel } from "../components/ResultPanel";
import { AssessmentReply } from "../components/AssessmentReply";
import { adminApi } from "../lib/adminApi";
import { isTruncatedSummary } from "../lib/format";
import type { QueryHistorySummary } from "../types/agent";
import { Badge, Empty, Field, LoadError, Loading, Modal, Notice, Section, dateTime, errorMessage, navigateTabs, useResource } from "./shared";

export function QueriesPage() {
  const [tab, setTab] = useState<"queries" | "audit">("queries");
  return <div className="adm-stack"><div className="adm-tabs" role="tablist" aria-label="记录类型" onKeyDown={navigateTabs}><button role="tab" tabIndex={tab === "queries" ? 0 : -1} aria-selected={tab === "queries"} onClick={() => setTab("queries")}>查询记录</button><button role="tab" tabIndex={tab === "audit" ? 0 : -1} aria-selected={tab === "audit"} onClick={() => setTab("audit")}>操作审计</button></div>{tab === "queries" ? <QueryHistory /> : <AuditHistory />}</div>;
}

function QueryHistory() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string>();
  const [deleting, setDeleting] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string }>();
  const resource = useResource(signal => adminApi.queries(page, query, status, signal), [page, query, status]);
  const pages = Math.max(1, Math.ceil((resource.data?.total ?? 0) / (resource.data?.page_size ?? 20)));
  const running = resource.data?.items.some(item => item.status === "running");
  useEffect(() => { if (!running || resource.loading) return; const timer = window.setTimeout(resource.refresh, 5000); return () => window.clearTimeout(timer); }, [running, resource.loading]);
  async function remove(item: QueryHistorySummary) {
    if (!window.confirm(`永久删除查询记录「${item.query.slice(0, 80)}」及其保存的结果？此操作无法撤销。`)) return;
    setDeleting(item.id); setFeedback(undefined);
    try { await adminApi.deleteQuery(item.id); if (selected === item.id) setSelected(undefined); setFeedback({ kind: "success", message: "查询记录已删除。" }); if (resource.data?.items.length === 1 && page > 1) setPage(page - 1); else resource.refresh(); }
    catch (error) { setFeedback({ kind: "error", message: errorMessage(error) }); }
    finally { setDeleting(""); }
  }
  return <div className="adm-stack">
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    <Section title="查询历史" description="查看执行结果、SQL 与错误详情，也可以导出已有结果。" action={<button className="adm-btn" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={16} />刷新记录</button>}>
      <form className="adm-filterbar" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}><Field label="搜索查询"><div className="adm-input-with-icon"><Search size={16} /><input maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="输入问题关键词" /></div></Field><Field label="执行状态"><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="done">已完成</option><option value="running">执行中</option><option value="error">失败</option><option value="stopped">已停止</option><option value="clarify">待补充</option><option value="unsupported">数据不足</option></select></Field><button className="adm-btn adm-btn-primary" type="submit">搜索</button></form>
      {resource.error && <div className="adm-section-body"><LoadError message={resource.error} retry={resource.refresh} /></div>}
      {resource.loading ? <Loading label="正在读取查询记录…" /> : resource.data && <><div className="adm-table-scroll"><table className="adm-table"><thead><tr><th>问题 / 摘要</th><th>状态</th><th>结果行数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{resource.data.items.map(item => <tr key={item.id}><td className="adm-query-cell"><button className="adm-text-link" onClick={() => setSelected(item.id)}>{item.query}</button><p className={`adm-cell-description ${item.error ? "adm-danger" : "adm-muted"}`}>{item.error || item.summary || "暂无摘要"}</p></td><td><Badge value={item.status} /></td><td>{item.row_count.toLocaleString("zh-CN")}</td><td className="adm-nowrap">{dateTime(item.created_at)}</td><td><div className="adm-inline adm-nowrap"><button className="adm-icon-btn" aria-label={`查看查询 ${item.query}`} onClick={() => setSelected(item.id)}><ExternalLink size={16} /></button><button className="adm-icon-btn adm-danger" aria-label={`删除查询 ${item.query}`} title={item.status === "running" ? "运行中的查询不能删除" : "删除记录"} disabled={item.status === "running" || !!deleting} onClick={() => void remove(item)}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>{!resource.data.items.length && <Empty>{query || status ? "没有符合筛选条件的查询记录。" : "暂无查询记录。前往问数工作台发起第一次查询。"}</Empty>}<div className="adm-pagination"><span className="adm-muted">共 {resource.data.total} 条 · 每页 {resource.data.page_size} 条</span><div className="adm-inline"><button className="adm-icon-btn" aria-label="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button><span>第 {page} / {pages} 页</span><button className="adm-icon-btn" aria-label="下一页" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button></div></div></>}
    </Section>
    {selected && <QueryDetail id={selected} onClose={() => setSelected(undefined)} />}
  </div>;
}

function QueryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const resource = useResource(signal => adminApi.query(id, signal), [id]);
  const running = resource.data?.status === "running";
  useEffect(() => { if (!running || resource.loading) return; const timer = window.setTimeout(resource.refresh, 2500); return () => window.clearTimeout(timer); }, [running, resource.loading]);
  return <Modal title="查询详情" onClose={onClose} wide>{resource.loading && !resource.data ? <Loading /> : resource.error ? <LoadError message={resource.error} retry={resource.refresh} /> : resource.data && <div className="adm-stack"><div className="adm-detail-question"><Badge value={resource.data.status} /><h3>{resource.data.query}</h3><p className="adm-muted">{dateTime(resource.data.created_at)} · {resource.data.row_count} 行结果</p></div>{resource.data.error && <Notice kind="error">{resource.data.error}</Notice>}{running && <Notice>查询仍在执行中，详情将自动更新。</Notice>}{resource.data.response ? <AssessmentReply response={resource.data.response} /> : resource.data.status === "clarify" || resource.data.status === "unsupported" ? <Notice>{resource.data.summary || "这条记录缺少可恢复的回复，请新建分析。"}</Notice> : <ResultPanel key={resource.data.updated_at} data={resource.data.result} sql={resource.data.sql ?? undefined} query={resource.data.query} truncated={isTruncatedSummary(resource.data.summary)} />}</div>}</Modal>;
}

function AuditHistory() {
  const resource = useResource(adminApi.audit);
  return <Section title="操作审计" description="最近 50 条管理操作及执行状态，不记录密码或 API Key 内容。" action={<button className="adm-btn" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={16} />刷新审计</button>}>
    {resource.loading ? <Loading /> : resource.error ? <div className="adm-section-body"><LoadError message={resource.error} retry={resource.refresh} /></div> : resource.data && <><div className="adm-table-scroll"><table className="adm-table"><thead><tr><th>时间</th><th>操作</th><th>状态</th><th>说明</th></tr></thead><tbody>{resource.data.items.map(entry => <tr key={entry.id}><td className="adm-nowrap">{dateTime(entry.at)}</td><td className="adm-code">{entry.action}</td><td><Badge value={entry.status} /></td><td>{entry.message || "—"}</td></tr>)}</tbody></table></div>{!resource.data.items.length && <Empty>暂无管理操作记录。</Empty>}</>}
  </Section>;
}
