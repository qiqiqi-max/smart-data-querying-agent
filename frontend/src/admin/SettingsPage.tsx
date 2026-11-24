import { Database, Eye, EyeOff, RefreshCw, Save, Search, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { adminApi } from "../lib/adminApi";
import type { ConnectionResult, DatabaseInput, ModelInput, SettingsInput, SettingsResponse } from "../types/admin";
import { Badge, Empty, Field, LoadError, Loading, Notice, Section, errorMessage, shortRevision, useDirty, useResource } from "./shared";

function toInput(value: SettingsResponse): SettingsInput {
  const db = ({ host, port, user, database }: DatabaseInput) => ({ host, port, user, database, password: "" });
  return { revision: value.revision, db_meta: db(value.saved.db_meta), db_dw: db(value.saved.db_dw), llm: { model_name: value.saved.llm.model_name, base_url: value.saved.llm.base_url, api_key: "" } };
}

function SecretField({ label, value, configured, onChange }: { label: string; value: string; configured: boolean; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return <Field label={label} hint="留空保留已有凭据；更换服务地址或数据库用户时需重新填写。"><div className="adm-input-with-action"><input type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} placeholder={configured ? "已配置 · 留空保留" : "尚未配置"} autoComplete="new-password" spellCheck={false} /><button type="button" className="adm-icon-btn" aria-label={visible ? "隐藏凭据" : "显示凭据"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></Field>;
}

export function SettingsPage({ mode, onDirty }: { mode: "database" | "model"; onDirty: (dirty: boolean) => void }) {
  const resource = useResource(adminApi.settings);
  const [draft, setDraft] = useState<SettingsInput>();
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; kind: "error" | "success" }>();
  const [tests, setTests] = useState<Record<string, ConnectionResult>>({});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (resource.data) { setDraft(toInput(resource.data)); setTests({}); } }, [resource.data]);
  const dirty = !!draft && !!resource.data && JSON.stringify(draft) !== JSON.stringify(toInput(resource.data));
  useDirty(dirty, onDirty);

  async function save() {
    if (!draft || !form.current?.reportValidity()) return;
    setBusy("save"); setFeedback(undefined);
    try { resource.setData(await adminApi.saveSettings(draft)); setFeedback({ kind: "success", message: "配置已保存。需要重启的变更将在后端重启后生效。" }); }
    catch (error) { setFeedback({ kind: "error", message: errorMessage(error) }); }
    finally { setBusy(""); }
  }
  async function test(key: "meta" | "dw" | "model") {
    if (!draft || !form.current?.reportValidity()) return;
    setBusy(key); setFeedback(undefined);
    try {
      const result = key === "model" ? await adminApi.testModel(draft.llm) : await adminApi.testDatabase(key, draft[key === "meta" ? "db_meta" : "db_dw"]);
      setTests(previous => ({ ...previous, [key]: result }));
    } catch (error) { setTests(previous => ({ ...previous, [key]: { ok: false, message: errorMessage(error), latency_ms: 0 } })); }
    finally { setBusy(""); }
  }
  function changeDb(kind: "db_meta" | "db_dw", key: keyof DatabaseInput, value: string | number) {
    setDraft(previous => previous ? { ...previous, [kind]: { ...previous[kind], [key]: value } } : previous);
    setTests(previous => { const next = { ...previous }; delete next[kind === "db_meta" ? "meta" : "dw"]; return next; });
    setFeedback(undefined);
  }
  function changeModel(key: keyof ModelInput, value: string) {
    setDraft(previous => previous ? { ...previous, llm: { ...previous.llm, [key]: value } } : previous); setTests({}); setFeedback(undefined);
  }

  if (resource.loading && !resource.data) return <Loading />;
  if (resource.error) return <LoadError message={resource.error} retry={resource.refresh} />;
  if (!resource.data || !draft) return <Loading />;
  const settings = resource.data;
  const connectionResult = (key: string) => tests[key] && <Notice kind={tests[key].ok ? "success" : "error"}>{tests[key].message}{tests[key].latency_ms > 0 && <span> · {Math.round(tests[key].latency_ms)} ms</span>}</Notice>;
  return <div className="adm-stack">
    <div className="adm-toolbar"><span className="adm-muted">已保存配置 · {shortRevision(settings.revision)}</span><button className="adm-btn" disabled={!!busy || resource.loading} onClick={() => { if (!dirty || window.confirm("重新读取服务器配置会放弃尚未保存的更改，确定继续吗？")) { setFeedback(undefined); resource.refresh(); } }}><RefreshCw size={16} />重新读取配置</button></div>
    {settings.restart_required && <Notice kind="warning">已有保存的配置尚未生效。请重启后端服务；下方「运行中配置」显示当前实际使用的值。</Notice>}
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    <form ref={form} onSubmit={event => { event.preventDefault(); void save(); }} className="adm-stack">
      <fieldset disabled={!!busy || resource.loading} className="adm-fieldset adm-stack">
      {mode === "database" ? (["db_meta", "db_dw"] as const).map(kind => {
        const title = kind === "db_meta" ? "元数据库" : "业务数仓";
        const key = kind === "db_meta" ? "meta" : "dw";
        const db = draft[kind];
        const effective = settings.effective[kind];
        return <Section key={kind} title={title} description={kind === "db_meta" ? "存储智能体使用的元数据与配置。" : "查询执行与表结构读取使用的数据源。"} action={<Badge value="info">MySQL · {key}</Badge>}>
          <div className="adm-section-body adm-stack">
            <div className="adm-form-grid">
              <Field label={`${title}主机`}><input required value={db.host} onChange={event => changeDb(kind, "host", event.target.value)} placeholder="127.0.0.1" /></Field>
              <Field label={`${title}端口`}><input type="number" required min={1} max={65535} value={db.port || ""} onChange={event => changeDb(kind, "port", Number(event.target.value))} /></Field>
              <Field label={`${title}数据库名`}><input required value={db.database} onChange={event => changeDb(kind, "database", event.target.value)} autoComplete="off" /></Field>
              <Field label={`${title}用户名`}><input required value={db.user} onChange={event => changeDb(kind, "user", event.target.value)} autoComplete="off" /></Field>
              <SecretField label={`${title}密码`} value={db.password ?? ""} configured={settings.saved[kind].password_set} onChange={value => changeDb(kind, "password", value)} />
            </div>
            <div className="adm-inline"><button type="button" className="adm-btn" onClick={() => void test(key)}><Unplug size={16} />{busy === key ? "测试中…" : "测试当前输入"}</button><span className="adm-muted">连接测试不会保存配置。</span></div>
            {connectionResult(key)}
            <details className="adm-details"><summary>运行中配置{JSON.stringify(settings.saved[kind]) !== JSON.stringify(effective) ? " · 与已保存配置不同" : " · 可见字段与已保存配置一致"}</summary><dl className="adm-definition"><dt>地址</dt><dd>{effective.host}:{effective.port}</dd><dt>数据库</dt><dd>{effective.database}</dd><dt>用户</dt><dd>{effective.user}</dd><dt>密码</dt><dd>{effective.password_set ? "已配置（内容不回显）" : "未配置"}</dd></dl></details>
          </div>
        </Section>;
      }) : <Section title="语言模型" description="为问数智能体配置兼容 OpenAI 的模型服务。" action={<Badge value={settings.saved.llm.api_key_set ? "ready" : "unconfigured"} />}>
        <div className="adm-section-body adm-stack"><div className="adm-form-grid">
          <Field label="模型名称" hint="填写模型服务支持的完整模型标识。"><input required value={draft.llm.model_name} onChange={event => changeModel("model_name", event.target.value)} placeholder="模型标识" /></Field>
          <Field label="接口地址" hint="使用模型服务提供的兼容 API 地址。"><input type="url" required value={draft.llm.base_url} onChange={event => changeModel("base_url", event.target.value)} placeholder="https://api.example.com/v1" /></Field>
          <SecretField label="API Key" value={draft.llm.api_key ?? ""} configured={settings.saved.llm.api_key_set} onChange={value => changeModel("api_key", value)} />
        </div><div className="adm-inline"><button type="button" className="adm-btn" onClick={() => void test("model")}><Unplug size={16} />{busy === "model" ? "测试中…" : "测试当前输入"}</button><span className="adm-muted">将向当前填写的服务发送一次测试请求，可能产生少量调用费用。</span></div>
        {connectionResult("model")}
        <details className="adm-details"><summary>运行中配置{JSON.stringify(settings.saved.llm) !== JSON.stringify(settings.effective.llm) ? " · 与已保存配置不同" : " · 可见字段与已保存配置一致"}</summary><dl className="adm-definition"><dt>模型</dt><dd>{settings.effective.llm.model_name}</dd><dt>接口地址</dt><dd>{settings.effective.llm.base_url}</dd><dt>API Key</dt><dd>{settings.effective.llm.api_key_set ? "已配置（内容不回显）" : "未配置"}</dd></dl></details></div>
      </Section>}
      <div className="adm-savebar"><span className={dirty ? "adm-unsaved" : "adm-muted"}>{dirty ? "有尚未保存的更改" : "配置已与服务器同步"}</span><div className="adm-inline"><button type="button" className="adm-btn" disabled={!dirty} onClick={() => { if (window.confirm("放弃尚未保存的配置更改？")) { setDraft(toInput(settings)); setFeedback(undefined); setTests({}); } }}>放弃更改</button><button type="submit" className="adm-btn adm-btn-primary" disabled={!dirty}><Save size={16} />{busy === "save" ? "保存中…" : "保存配置"}</button></div></div>
      </fieldset>
    </form>
    {mode === "database" && <SchemaInspector />}
  </div>;
}

function SchemaInspector() {
  const resource = useResource(adminApi.schema);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("");
  const tables = resource.data?.tables.filter(table => table.name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const current = resource.data?.tables.find(table => table.name === selected);
  return <Section title="数仓表结构" description="读取当前运行中的业务数仓；保存连接后需重启才能切换。" action={<button className="adm-btn" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={16} />刷新结构</button>}>
    {resource.loading ? <Loading label="正在读取真实表结构…" /> : resource.error ? <div className="adm-section-body"><LoadError message={resource.error} retry={resource.refresh} /></div> : <div className="adm-schema-layout"><div className="adm-schema-list"><Field label="搜索数据表"><div className="adm-input-with-icon"><Search size={16} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="输入表名" /></div></Field><div className="adm-table-picker">{tables.map(table => <button key={table.name} className={selected === table.name ? "is-active" : ""} onClick={() => setSelected(table.name)}><Database size={16} /><span>{table.name}</span><span className="adm-muted">{table.columns.length}</span></button>)}{tables.length === 0 && <Empty>没有匹配的数据表。</Empty>}</div></div><div className="adm-schema-detail">{current ? <><div className="adm-section-head"><h3>{current.name}</h3><span className="adm-muted">{current.columns.length} 个字段</span></div><div className="adm-table-scroll"><table className="adm-table"><thead><tr><th>字段</th><th>类型</th><th>可空</th><th>说明</th></tr></thead><tbody>{current.columns.map(column => <tr key={column.name}><td><span className="adm-code">{column.name}</span>{column.primary_key && <Badge value="info">主键</Badge>}</td><td>{column.type}</td><td>{column.nullable ? "是" : "否"}</td><td>{column.comment || "—"}</td></tr>)}</tbody></table></div></> : <Empty><Database size={28} /><p>选择数据表，查看字段与约束。</p></Empty>}</div></div>}
  </Section>;
}
