import { BookOpenCheck, CirclePlay, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "../lib/adminApi";
import { Badge, Empty, LoadError, Loading, Modal, Notice, Section, dateTime, errorMessage, shortRevision, useResource } from "./shared";

export function KnowledgePage() {
  const resource = useResource(async signal => { const [builds, overview] = await Promise.all([adminApi.builds(signal), adminApi.overview(signal)]); return { builds: builds.items, overview }; });
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();
  const active = resource.data?.builds.find(build => build.status === "running" || build.status === "queued");
  useEffect(() => { if (!active || resource.loading) return; const timer = window.setTimeout(resource.refresh, 2500); return () => window.clearTimeout(timer); }, [active, resource.loading]);
  async function start() {
    setStarting(true); setFeedback(undefined);
    try { await adminApi.startBuild(); setConfirm(false); setFeedback({ kind: "success", message: "构建任务已创建，页面会在任务执行期间自动更新。" }); resource.refresh(); }
    catch (error) { setConfirm(false); setFeedback({ kind: "error", message: errorMessage(error) }); }
    finally { setStarting(false); }
  }
  if (resource.loading && !resource.data) return <Loading />;
  if (resource.error && !resource.data) return <LoadError message={resource.error} retry={resource.refresh} />;
  if (!resource.data) return null;
  const { overview, builds } = resource.data;
  return <div className="adm-stack">
    {resource.error && <LoadError message={resource.error} retry={resource.refresh} />}
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    {overview.maintenance.blocked && !active && <Notice kind="warning">知识库尚未恢复可用，系统保持维护状态。请修复下方失败原因并重新构建，成功后将自动恢复查询。</Notice>}
    {overview.restart_required && <Notice kind="warning">有连接或模型配置等待后端重启。本次构建会使用当前运行中的配置。</Notice>}
    <Section title="知识库构建" description="把最新表结构、字段语义和业务指标同步为智能体可检索的知识。" action={<button className="adm-btn" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={16} />刷新</button>}><div className="adm-section-body adm-stack"><div className="adm-build-summary"><div className="adm-build-icon"><BookOpenCheck size={30} /></div><div><h3>{active ? "正在构建知识库" : overview.knowledge.dirty ? "有配置等待构建" : "配置与知识库已同步"}</h3><p className="adm-muted">当前配置 {shortRevision(overview.knowledge.revision)} · 已构建 {shortRevision(overview.knowledge.built_revision)}</p></div><Badge value={active ? "running" : overview.knowledge.dirty ? "warning" : "ready"}>{active ? "执行中" : overview.knowledge.dirty ? "待构建" : "已同步"}</Badge></div>
      {active && <div className="adm-build-progress" aria-live="polite"><div className="adm-toolbar"><strong>{active.stage || "等待开始"}</strong><span>已完成 {active.completed_stages} / {active.total_stages} 个阶段</span></div><progress value={active.completed_stages} max={Math.max(1, active.total_stages)} aria-label="已完成的构建阶段" /><p className="adm-muted">按实际完成阶段展示，各阶段用时不同。构建期间暂停新查询。</p></div>}
      <div className="adm-inline"><button className="adm-btn adm-btn-primary" disabled={starting || !!active || overview.maintenance.building || overview.maintenance.active_queries > 0} onClick={() => setConfirm(true)}><CirclePlay size={17} />{active ? "构建进行中" : "全量重建知识库"}</button><span className="adm-muted">{overview.maintenance.active_queries > 0 ? `当前有 ${overview.maintenance.active_queries} 个查询执行中，完成后刷新即可构建。` : "仅构建已保存的元数据。"}</span></div>
    </div></Section>
    <Section title="构建记录" description="最近的任务、实际执行阶段与错误信息。"><div className="adm-table-scroll"><table className="adm-table"><thead><tr><th>创建时间 / 任务</th><th>状态</th><th>阶段</th><th>配置版本</th><th>最后更新</th></tr></thead><tbody>{builds.map(build => <tr key={build.id}><td>{dateTime(build.created_at)}<div className="adm-code adm-muted">{shortRevision(build.id)}</div></td><td><Badge value={build.status} /></td><td><strong>{build.stage || "等待开始"}</strong><div className="adm-muted">{build.completed_stages} / {build.total_stages} 个阶段</div>{build.error && <p className="adm-build-error">{build.error}</p>}</td><td className="adm-code">{shortRevision(build.revision)}</td><td>{dateTime(build.updated_at)}</td></tr>)}</tbody></table></div>{!builds.length && <Empty>暂无构建记录。保存元数据后，创建第一次构建。</Empty>}</Section>
    {confirm && <Modal title="确认全量重建知识库" onClose={() => { if (!starting) setConfirm(false); }}><div className="adm-stack"><Notice kind="warning">构建会替换现有知识库内容。构建期间系统进入维护状态，新的查询会被暂停。</Notice><p>系统将先检查真实数仓中的表与字段，再同步已保存的元数据及字段值。如果构建失败，维护状态会保留，直到修复原因并成功重建。</p><dl className="adm-definition"><dt>将构建的配置</dt><dd className="adm-code">{shortRevision(overview.knowledge.revision)}</dd><dt>当前活动查询</dt><dd>{overview.maintenance.active_queries}</dd></dl><div className="adm-modal-actions"><button className="adm-btn" disabled={starting} onClick={() => setConfirm(false)}>取消</button><button className="adm-btn adm-btn-primary" disabled={starting} onClick={() => void start()}>{starting ? "正在创建任务…" : "确认并开始重建"}</button></div></div></Modal>}
  </div>;
}
