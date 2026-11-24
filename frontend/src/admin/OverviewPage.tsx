import { Activity, ArrowRight, BookOpen, Database, GitBranch, ListChecks, RefreshCw, Settings2 } from "lucide-react";
import { adminApi } from "../lib/adminApi";
import { Badge, LoadError, Loading, Notice, Section, shortRevision, useResource } from "./shared";

export type AdminPage = "overview" | "sources" | "model" | "metadata" | "knowledge" | "queries";

export function OverviewPage({ navigate }: { navigate: (page: AdminPage) => void }) {
  const resource = useResource(adminApi.overview);
  if (resource.loading && !resource.data) return <Loading label="正在读取系统状态…" />;
  if (resource.error) return <LoadError message={resource.error} retry={resource.refresh} />;
  if (!resource.data) return null;
  const data = resource.data;
  const counts = [{ label: "数据表", value: data.counts.tables, icon: Database, page: "metadata" as const }, { label: "字段定义", value: data.counts.columns, icon: GitBranch, page: "metadata" as const }, { label: "业务指标", value: data.counts.metrics, icon: BookOpen, page: "metadata" as const }, { label: "查询记录", value: data.counts.queries, icon: ListChecks, page: "queries" as const }];
  return <div className="adm-stack">
    <div className="adm-toolbar"><div className="adm-inline"><Badge value="info">本机管理</Badge><Badge value={data.demo_mode ? "warning" : "ready"}>{data.demo_mode ? "演示模式" : "真实数据模式"}</Badge></div><button className="adm-btn" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={16} />刷新状态</button></div>
    {data.demo_mode && <Notice kind="warning">当前后端处于演示模式。查询不会访问真实数仓；配置与元数据管理仍会保存实际变更。</Notice>}
    {data.maintenance.blocked && <Notice kind="warning">{data.maintenance.building ? "知识库正在构建，新查询暂时不可用。" : "系统处于维护状态。请检查构建错误并成功重建知识库后恢复查询。"}<button className="adm-btn adm-btn-small" onClick={() => navigate("knowledge")}>查看构建任务</button></Notice>}
    {data.restart_required && <Notice kind="warning">连接或模型配置已有保存的变更，等待后端重启后生效。</Notice>}
    <div className="adm-stat-grid">{counts.map(item => <button className="adm-stat" key={item.label} onClick={() => navigate(item.page)}><div><span>{item.label}</span><item.icon size={19} /></div><strong>{item.value.toLocaleString("zh-CN")}</strong><span className="adm-stat-link">查看详情 <ArrowRight size={14} /></span></button>)}</div>
    <div className="adm-two-columns"><Section title="服务状态" description="来自当前后端进程的实际运行状态。"><div className="adm-service-list">{data.services.map(service => <div className="adm-service" key={service.name}><div className="adm-service-icon"><Settings2 size={19} /></div><div className="adm-service-copy"><strong>{service.name}</strong><p>{service.message || "暂无补充信息"}</p></div><Badge value={service.status}>{service.status === "ready" && service.name === "大模型" ? "已配置" : service.status === "ready" && service.name === "Embedding" ? "已初始化" : undefined}</Badge></div>)}{!data.services.length && <p className="adm-muted">服务尚未返回状态。</p>}</div></Section>
    <Section title="知识库版本" description="保存元数据后，构建知识库才能用于问数。" action={<BookOpen size={20} className="adm-muted" />}><div className="adm-section-body adm-stack"><div className="adm-inline"><Badge value={data.knowledge.dirty ? "warning" : "ready"}>{data.knowledge.dirty ? "有待构建的更改" : "与配置一致"}</Badge></div><dl className="adm-definition"><dt>当前配置版本</dt><dd className="adm-code">{shortRevision(data.knowledge.revision)}</dd><dt>已构建版本</dt><dd className="adm-code">{shortRevision(data.knowledge.built_revision)}</dd><dt>活动查询</dt><dd>{data.maintenance.active_queries} 个</dd></dl><button className="adm-btn" onClick={() => navigate("knowledge")}>管理知识库 <ArrowRight size={16} /></button></div></Section></div>
    <Section title="查询运行概况" description="按历史记录的当前状态统计。" action={<Activity size={20} className="adm-muted" />}><div className="adm-query-counts">{["done", "running", "error", "stopped"].map(status => <div key={status}><Badge value={status} /><strong>{(data.query_status[status] ?? 0).toLocaleString("zh-CN")}</strong></div>)}</div></Section>
    <div className="adm-workflow"><div><h2>配置到问数，按这个顺序准备</h2><p>连接数据源与模型 → 定义元数据 → 构建知识库 → 返回工作台查询</p></div><button className="adm-btn" onClick={() => navigate("sources")}>管理数据源 <ArrowRight size={16} /></button></div>
  </div>;
}
