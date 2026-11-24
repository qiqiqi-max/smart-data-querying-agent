import { ArrowLeft, BookOpenCheck, ChevronRight, Database, LayoutDashboard, ListChecks, Menu, Network, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { KnowledgePage } from "./KnowledgePage";
import { MetadataPage } from "./MetadataPage";
import { OverviewPage, type AdminPage } from "./OverviewPage";
import { QueriesPage } from "./QueriesPage";
import { SettingsPage } from "./SettingsPage";
import "./admin.css";

const pages = [
  { id: "overview", label: "系统概览", icon: LayoutDashboard, description: "查看服务状态、知识库版本与查询运行情况。" },
  { id: "sources", label: "数据源管理", icon: Database, description: "管理 MySQL 连接，测试连通性并检查真实表结构。" },
  { id: "model", label: "模型配置", icon: Sparkles, description: "配置智能体使用的模型服务与访问凭据。" },
  { id: "metadata", label: "元数据与指标", icon: Network, description: "定义数据的业务含义，维护表、字段与指标。" },
  { id: "knowledge", label: "知识库构建", icon: BookOpenCheck, description: "将已保存的业务定义构建为智能体可用的知识。" },
  { id: "queries", label: "查询与审计", icon: ListChecks, description: "检索查询结果与 SQL，追踪管理操作记录。" },
] as const;

export default function AdminApp() {
  const [page, setPage] = useState<AdminPage>("overview");
  const [dirty, setDirty] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const current = pages.find(item => item.id === page)!;
  const navigate = useCallback((next: AdminPage) => {
    if (next === page) { setDrawerOpen(false); return; }
    if (dirty && !window.confirm("有尚未保存的更改，切换页面后将丢失。确定离开吗？")) return;
    setDirty(false); setPage(next); setDrawerOpen(false); main.current?.scrollTo({ top: 0 });
  }, [dirty, page]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 851px)");
    const closeOnDesktop = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
      if (event.key !== "Tab") return;
      const buttons = Array.from(sidebar.current?.querySelectorAll<HTMLElement>("button,a[href]") ?? []).filter(item => item.getClientRects().length);
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [drawerOpen]);
  return <div className="adm-app" data-admin-dirty={dirty ? "true" : "false"}>
    <a className="adm-skip-link" href="#admin-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>跳到管理内容</a>
    {drawerOpen && <button className="adm-drawer-backdrop" aria-label="关闭导航" onClick={() => setDrawerOpen(false)} />}
    <aside className={`adm-sidebar${drawerOpen ? " is-open" : ""}`} ref={sidebar} role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen ? true : undefined} aria-label="管理台导航">
      <div className="adm-brand"><span className="adm-brand-symbol"><Network size={23} /></span><div><strong>智能问数</strong><span>管理控制台</span></div><button className="adm-icon-btn adm-drawer-close" aria-label="关闭导航" onClick={() => setDrawerOpen(false)}><X size={20} /></button></div>
      <div className="adm-nav-label">工作空间管理</div><nav>{pages.map(item => <button key={item.id} className={`adm-nav-item${page === item.id ? " is-active" : ""}`} aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.label}</span>{page === item.id && <ChevronRight size={16} />}</button>)}</nav>
      <div className="adm-sidebar-bottom"><div className="adm-local-mode"><ShieldCheck size={18} /><div><strong>本机管理模式</strong><span>配置与记录保存在本地服务</span></div></div><a className="adm-return" href="#/" onClick={event => { if (dirty && !window.confirm("有尚未保存的更改，返回工作台后将丢失。确定离开吗？")) event.preventDefault(); else setDirty(false); }}><ArrowLeft size={17} />返回问数工作台</a></div>
    </aside>
    <div className="adm-workspace" inert={drawerOpen ? true : undefined}><header className="adm-topbar"><div className="adm-inline"><button className="adm-icon-btn adm-menu-button" aria-label="打开导航" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu size={22} /></button><Settings2 size={18} className="adm-topbar-icon" /><span className="adm-muted">管理控制台</span><ChevronRight size={15} className="adm-muted" /><strong>{current.label}</strong></div><span className="adm-topbar-label">ADMIN</span></header>
      <main className="adm-main" id="admin-content" ref={main} tabIndex={-1}><div className="adm-content"><div className="adm-page-heading"><h1>{current.label}</h1><p>{current.description}</p></div>
        {page === "overview" && <OverviewPage navigate={navigate} />}
        {page === "sources" && <SettingsPage key="sources" mode="database" onDirty={setDirty} />}
        {page === "model" && <SettingsPage key="model" mode="model" onDirty={setDirty} />}
        {page === "metadata" && <MetadataPage onDirty={setDirty} openBuilds={() => navigate("knowledge")} />}
        {page === "knowledge" && <KnowledgePage />}
        {page === "queries" && <QueriesPage />}
        <footer className="adm-footer">智能问数 · 管理控制台</footer>
      </div></main>
    </div>
  </div>;
}
