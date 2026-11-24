import { CheckCheck, Database, Download, Pencil, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../lib/adminApi";
import type { Metadata, MetadataColumn, MetadataInput, MetadataMetric, MetadataTable, SchemaTable } from "../types/admin";
import { Badge, Empty, Field, LoadError, Loading, Modal, Notice, Section, errorMessage, navigateTabs, shortRevision, useDirty, useResource } from "./shared";

const roles: Record<MetadataColumn["role"], string> = { primary_key: "主键", foreign_key: "外键", measure: "度量", dimension: "维度" };
const splitList = (value: string) => [...new Set(value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean))];
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
function inputOf(data: Metadata): MetadataInput { return { revision: data.revision, tables: structuredClone(data.tables), metrics: structuredClone(data.metrics) }; }

export function validateMetadata(data: MetadataInput): string[] {
  const errors: string[] = []; const tables = new Set<string>(); const columns = new Set<string>(); const metrics = new Set<string>();
  if (data.tables.length > 500) errors.push("最多支持 500 张元数据表。");
  if (data.metrics.length > 1000) errors.push("最多支持 1000 个业务指标。");
  const validateText = (label: string, item: { description: string; alias?: string[] }) => {
    if (item.description.length > 10000) errors.push(`${label}的描述不能超过 10000 个字符。`);
    if (item.alias && (item.alias.length > 100 || item.alias.some(alias => !alias.trim() || alias.trim().length > 128))) errors.push(`${label}最多支持 100 个别名，每个别名需为 1–128 个字符。`);
  };
  for (const table of data.tables) {
    if (!identifier.test(table.name)) errors.push(`表名「${table.name}」必须以字母或下划线开头，仅包含字母、数字、下划线。`);
    if (table.name.length > 64) errors.push(`表名「${table.name}」不能超过 64 个字符。`);
    if (tables.has(table.name.toLowerCase())) errors.push(`数据表「${table.name}」重名。`);
    tables.add(table.name.toLowerCase());
    validateText(`数据表「${table.name}」`, table);
    if (table.columns.length > 1000) errors.push(`数据表「${table.name}」最多支持 1000 个字段。`);
    const names = new Set<string>();
    for (const column of table.columns) {
      if (!identifier.test(column.name)) errors.push(`字段「${table.name}.${column.name}」不是有效标识符。`);
      if (`${table.name}.${column.name}`.length > 64) errors.push(`字段「${table.name}.${column.name}」的完整名称不能超过 64 个字符。`);
      if (names.has(column.name.toLowerCase())) errors.push(`字段「${table.name}.${column.name}」重名。`);
      validateText(`字段「${table.name}.${column.name}」`, column);
      names.add(column.name.toLowerCase()); columns.add(`${table.name}.${column.name}`);
    }
  }
  for (const metric of data.metrics) {
    if (!metric.name.trim()) errors.push("指标名称不能为空。");
    if (metric.name.length > 64) errors.push(`指标「${metric.name}」不能超过 64 个字符。`);
    if (metrics.has(metric.name.toLowerCase())) errors.push(`指标「${metric.name}」重名。`);
    metrics.add(metric.name.toLowerCase());
    validateText(`指标「${metric.name}」`, metric);
    if (metric.relevant_columns.length > 1000) errors.push(`指标「${metric.name}」最多支持 1000 个关联字段。`);
    if (new Set(metric.relevant_columns).size !== metric.relevant_columns.length) errors.push(`指标「${metric.name}」包含重复关联字段。`);
    for (const column of metric.relevant_columns) if (!columns.has(column)) errors.push(`指标「${metric.name}」引用了不存在的字段「${column}」。`);
  }
  return errors;
}

type Editor = { kind: "table"; index: number; value: MetadataTable } | { kind: "column"; tableIndex: number; index: number; value: MetadataColumn } | { kind: "metric"; index: number; value: MetadataMetric };

export function MetadataPage({ onDirty, openBuilds }: { onDirty: (value: boolean) => void; openBuilds: () => void }) {
  const resource = useResource(adminApi.metadata);
  const [draft, setDraft] = useState<MetadataInput>();
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<"tables" | "metrics">("tables");
  const [filter, setFilter] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success" | "info"; messages: string[] }>();
  useEffect(() => { if (resource.data) setDraft(inputOf(resource.data)); }, [resource.data]);
  const dirty = !!draft && !!resource.data && JSON.stringify(draft) !== JSON.stringify(inputOf(resource.data));
  useDirty(dirty || !!editor, onDirty);
  const table = draft?.tables[selected];
  const availableColumns = useMemo(() => draft?.tables.flatMap(item => item.columns.map(column => `${item.name}.${column.name}`)) ?? [], [draft]);
  function mutate(update: (value: MetadataInput) => void) { setDraft(previous => { if (!previous) return previous; const next = structuredClone(previous); update(next); return next; }); setFeedback(undefined); }
  function commitEditor(value: MetadataTable | MetadataColumn | MetadataMetric) {
    if (!editor) return;
    if (editor.kind === "table" && editor.index < 0) setSelected(draft?.tables.length ?? 0);
    mutate(next => {
      if (editor.kind === "table") {
        const updated = value as MetadataTable;
        if (editor.index < 0) next.tables.push(updated);
        else {
          const oldName = next.tables[editor.index].name;
          next.tables[editor.index] = updated;
          if (oldName !== updated.name) next.metrics.forEach(metric => { metric.relevant_columns = metric.relevant_columns.map(ref => ref.startsWith(`${oldName}.`) ? `${updated.name}.${ref.slice(oldName.length + 1)}` : ref); });
        }
      } else if (editor.kind === "column") {
        const target = next.tables[editor.tableIndex]; const updated = value as MetadataColumn;
        if (editor.index < 0) target.columns.push(updated);
        else { const oldRef = `${target.name}.${target.columns[editor.index].name}`; target.columns[editor.index] = updated; next.metrics.forEach(metric => { metric.relevant_columns = metric.relevant_columns.map(ref => ref === oldRef ? `${target.name}.${updated.name}` : ref); }); }
      } else if (editor.index < 0) next.metrics.push(value as MetadataMetric);
      else next.metrics[editor.index] = value as MetadataMetric;
    }); setEditor(undefined);
  }
  function deleteTable(index: number) {
    if (!draft) return;
    const target = draft.tables[index];
    const refs = draft.metrics.filter(metric => metric.relevant_columns.some(ref => ref.startsWith(`${target.name}.`)));
    if (refs.length) { setFeedback({ kind: "error", messages: [`「${target.name}」被指标 ${refs.map(metric => metric.name).join("、")} 引用，请先修改这些指标。`] }); return; }
    if (window.confirm(`从元数据中删除表「${target.name}」及其 ${target.columns.length} 个字段？此操作不会删除数据库中的真实数据。`)) { mutate(next => { next.tables.splice(index, 1); }); setSelected(Math.max(0, index - 1)); }
  }
  function deleteColumn(index: number) {
    if (!draft || !table) return;
    const ref = `${table.name}.${table.columns[index].name}`;
    const refs = draft.metrics.filter(metric => metric.relevant_columns.includes(ref));
    if (refs.length) { setFeedback({ kind: "error", messages: [`「${ref}」被指标 ${refs.map(metric => metric.name).join("、")} 引用，请先修改这些指标。`] }); return; }
    if (window.confirm(`从元数据中删除字段「${ref}」？不会修改真实数据库。`)) mutate(next => { next.tables[selected].columns.splice(index, 1); });
  }
  async function save() {
    if (!draft) return;
    const errors = validateMetadata(draft);
    if (errors.length) { setFeedback({ kind: "error", messages: errors }); return; }
    setSaving(true); setFeedback(undefined);
    try { resource.setData(await adminApi.saveMetadata(draft)); setFeedback({ kind: "success", messages: ["元数据已保存。请前往知识库构建，让智能体使用最新定义。"] }); }
    catch (error) { setFeedback({ kind: "error", messages: [errorMessage(error)] }); }
    finally { setSaving(false); }
  }
  function importSchema(tables: SchemaTable[], selectedColumns: Set<string>) {
    let addedTables = 0; let addedColumns = 0;
    if (!draft) return;
    const next = structuredClone(draft);
    for (const source of tables) {
      const columns = source.columns.filter(column => selectedColumns.has(`${source.name}.${column.name}`));
      if (!columns.length) continue;
      let target = next.tables.find(item => item.name === source.name);
      if (!target) { target = { name: source.name, role: source.name.startsWith("dim_") ? "dim" : "fact", description: "", columns: [] }; next.tables.push(target); addedTables++; }
      for (const column of columns) if (!target.columns.some(item => item.name === column.name)) { target.columns.push({ name: column.name, role: column.primary_key ? "primary_key" : "dimension", description: column.comment || "", alias: [], sync: false }); addedColumns++; }
    }
    setDraft(next); setImporting(false); setFeedback({ kind: "success", messages: [`已合并 ${addedTables} 张新表、${addedColumns} 个新字段。原有描述、角色、别名与指标均已保留；请检查后保存。`] });
  }
  if (resource.loading && !resource.data) return <Loading />;
  if (resource.error) return <LoadError message={resource.error} retry={resource.refresh} />;
  if (!draft || !resource.data) return <Loading />;
  return <div className="adm-stack">
    <div className="adm-toolbar"><div className="adm-inline"><Badge value={resource.data.dirty ? "warning" : "ready"}>{resource.data.dirty ? "已保存 · 待构建" : "已构建"}</Badge><span className="adm-muted">配置版本 {shortRevision(resource.data.revision)}</span></div><div className="adm-inline"><button className="adm-btn" disabled={saving || resource.loading} onClick={() => { if (!dirty || window.confirm("重新读取会放弃所有尚未保存的元数据更改，确定继续吗？")) { setFeedback(undefined); setSelected(0); resource.refresh(); } }}><RefreshCw size={16} />重新读取</button><button className="adm-btn" onClick={openBuilds}>查看知识库构建</button></div></div>
    {feedback && <Notice kind={feedback.kind}>{feedback.messages.length === 1 ? feedback.messages[0] : <ul>{feedback.messages.map((message, index) => <li key={index}>{message}</li>)}</ul>}</Notice>}
    <fieldset className="adm-fieldset adm-stack" disabled={saving || resource.loading}>
    <div className="adm-tabs" role="tablist" aria-label="元数据类型" onKeyDown={navigateTabs}><button role="tab" tabIndex={tab === "tables" ? 0 : -1} aria-selected={tab === "tables"} onClick={() => setTab("tables")}>数据表与字段 <span>{draft.tables.length}</span></button><button role="tab" tabIndex={tab === "metrics" ? 0 : -1} aria-selected={tab === "metrics"} onClick={() => setTab("metrics")}>业务指标 <span>{draft.metrics.length}</span></button></div>
    {tab === "tables" ? <Section title="数据表定义" description="补充业务语义，让智能体理解真实字段。" action={<div className="adm-inline"><button className="adm-btn" onClick={() => setImporting(true)}><Download size={16} />从数仓导入</button><button className="adm-btn adm-btn-primary" onClick={() => setEditor({ kind: "table", index: -1, value: { name: "", role: "fact", description: "", columns: [] } })}><Plus size={16} />新增表</button></div>}>
      <div className="adm-schema-layout"><div className="adm-schema-list"><Field label="搜索元数据表"><div className="adm-input-with-icon"><Search size={16} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="表名或描述" /></div></Field><div className="adm-table-picker">{draft.tables.map((item, index) => ({ item, index })).filter(({ item }) => `${item.name} ${item.description}`.toLowerCase().includes(filter.toLowerCase())).map(({ item, index }) => <button key={index} className={selected === index ? "is-active" : ""} onClick={() => setSelected(index)}><Database size={16} /><span>{item.name}</span><span className="adm-muted">{item.columns.length}</span></button>)}</div>{draft.tables.length === 0 && <Empty>暂无元数据表。可从真实数仓导入。</Empty>}</div>
      <div className="adm-schema-detail">{table ? <><div className="adm-section-head"><div><h3>{table.name} <Badge value="info">{table.role === "fact" ? "事实表" : "维度表"}</Badge></h3><p>{table.description || "尚未填写表描述"}</p></div><div className="adm-inline"><button className="adm-icon-btn" aria-label={`编辑表 ${table.name}`} onClick={() => setEditor({ kind: "table", index: selected, value: structuredClone(table) })}><Pencil size={16} /></button><button className="adm-icon-btn adm-danger" aria-label={`删除表 ${table.name}`} onClick={() => deleteTable(selected)}><Trash2 size={16} /></button></div></div>
      <div className="adm-table-scroll"><table className="adm-table"><thead><tr><th>字段 / 说明</th><th>角色</th><th>别名</th><th>值同步</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{table.columns.map((column, index) => <tr key={index}><td><strong className="adm-code">{column.name}</strong><div className="adm-muted adm-cell-description">{column.description || "未填写描述"}</div></td><td>{roles[column.role]}</td><td>{column.alias.join("、") || "—"}</td><td><Badge value={column.sync ? "ready" : "neutral"}>{column.sync ? "开启" : "关闭"}</Badge></td><td><div className="adm-inline adm-nowrap"><button className="adm-icon-btn" aria-label={`编辑字段 ${column.name}`} onClick={() => setEditor({ kind: "column", tableIndex: selected, index, value: structuredClone(column) })}><Pencil size={16} /></button><button className="adm-icon-btn adm-danger" aria-label={`删除字段 ${column.name}`} onClick={() => deleteColumn(index)}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>{!table.columns.length && <Empty>该表还没有字段。</Empty>}<div className="adm-section-body"><button className="adm-btn" onClick={() => setEditor({ kind: "column", tableIndex: selected, index: -1, value: { name: "", role: "dimension", description: "", alias: [], sync: false } })}><Plus size={16} />新增字段</button></div></> : <Empty>选择数据表，管理字段定义。</Empty>}</div></div>
    </Section> : <Section title="业务指标" description="定义指标含义、常用别名及其关联字段。" action={<button className="adm-btn adm-btn-primary" onClick={() => setEditor({ kind: "metric", index: -1, value: { name: "", description: "", relevant_columns: [], alias: [] } })}><Plus size={16} />新增指标</button>}>
      {draft.metrics.length ? <div className="adm-table-scroll"><table className="adm-table"><thead><tr><th>指标 / 定义</th><th>关联字段</th><th>别名</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{draft.metrics.map((metric, index) => <tr key={index}><td><strong>{metric.name}</strong><p className="adm-muted adm-cell-description">{metric.description || "未填写描述"}</p></td><td>{metric.relevant_columns.map(ref => <div className="adm-code" key={ref}>{ref}</div>)}</td><td>{metric.alias.join("、") || "—"}</td><td><div className="adm-inline adm-nowrap"><button className="adm-icon-btn" aria-label={`编辑指标 ${metric.name}`} onClick={() => setEditor({ kind: "metric", index, value: structuredClone(metric) })}><Pencil size={16} /></button><button className="adm-icon-btn adm-danger" aria-label={`删除指标 ${metric.name}`} onClick={() => { if (window.confirm(`删除指标「${metric.name}」？保存后生效。`)) mutate(next => { next.metrics.splice(index, 1); }); }}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div> : <Empty>暂无业务指标。添加指标，帮助智能体理解业务口径。</Empty>}
    </Section>}
    <div className="adm-savebar"><span className={dirty ? "adm-unsaved" : "adm-muted"}>{dirty ? "有尚未保存的更改" : "当前无待保存更改"}</span><div className="adm-inline"><button className="adm-btn" disabled={!dirty} onClick={() => { if (window.confirm("放弃所有尚未保存的元数据更改？")) { setDraft(inputOf(resource.data!)); setFeedback(undefined); setSelected(0); } }}>放弃更改</button><button className="adm-btn" onClick={() => { const errors = validateMetadata(draft); setFeedback({ kind: errors.length ? "error" : "success", messages: errors.length ? errors : ["校验通过：表名、字段名、重复项及指标引用均有效。"] }); }}><CheckCheck size={16} />校验配置</button><button className="adm-btn adm-btn-primary" disabled={!dirty} onClick={() => void save()}><Save size={16} />{saving ? "保存中…" : "保存元数据"}</button></div></div>
    </fieldset>
    {editor && <MetadataEditor editor={editor} availableColumns={availableColumns} onClose={() => setEditor(undefined)} onSave={commitEditor} />}
    {importing && <SchemaImport existing={draft.tables} onClose={() => setImporting(false)} onImport={importSchema} />}
  </div>;
}

function MetadataEditor({ editor, availableColumns, onClose, onSave }: { editor: Editor; availableColumns: string[]; onClose: () => void; onSave: (value: MetadataTable | MetadataColumn | MetadataMetric) => void }) {
  const [value, setValue] = useState(editor.value);
  const [aliases, setAliases] = useState("alias" in editor.value ? editor.value.alias.join("，") : "");
  const [error, setError] = useState("");
  const [columnFilter, setColumnFilter] = useState("");
  const changed = JSON.stringify(value) !== JSON.stringify(editor.value) || ("alias" in editor.value && aliases !== editor.value.alias.join("，"));
  const close = () => { if (!changed || window.confirm("放弃当前编辑内容？")) onClose(); };
  const kindLabel = editor.kind === "table" ? "数据表" : editor.kind === "column" ? "字段" : "指标";
  const update = (key: string, next: unknown) => setValue(previous => ({ ...previous, [key]: next }));
  return <Modal title={`${editor.index < 0 ? "新增" : "编辑"}${kindLabel}`} onClose={close}><form className="adm-stack" onSubmit={event => {
    event.preventDefault();
    if (editor.kind !== "metric" && !identifier.test(value.name)) { setError("名称必须以字母或下划线开头，只能包含字母、数字和下划线。"); return; }
    onSave({ ...value, name: value.name.trim(), ...("alias" in value ? { alias: splitList(aliases) } : {}) });
  }}>
    {error && <Notice kind="error">{error}</Notice>}
    <Field label={`${kindLabel}名称`} hint={editor.kind !== "metric" ? "与真实数据库标识一致。重命名会同步更新指标中的关联引用；表名.字段名的总长度最多 64 个字符。" : undefined}><input autoFocus required maxLength={64} value={value.name} onChange={event => update("name", event.target.value)} /></Field>
    {editor.kind === "table" && <Field label="表类型"><select value={(value as MetadataTable).role} onChange={event => update("role", event.target.value)}><option value="fact">事实表</option><option value="dim">维度表</option></select></Field>}
    {editor.kind === "column" && <Field label="字段角色"><select value={(value as MetadataColumn).role} onChange={event => update("role", event.target.value)}>{Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>}
    <Field label="业务描述"><textarea rows={3} maxLength={10000} value={value.description} onChange={event => update("description", event.target.value)} placeholder="说明这个定义的业务含义与使用方式" /></Field>
    {editor.kind !== "table" && <Field label="常用别名" hint="多个别名用逗号或换行分隔。"><textarea rows={2} value={aliases} onChange={event => setAliases(event.target.value)} placeholder="例如：销售额，成交额" /></Field>}
    {editor.kind === "column" && <label className="adm-checkbox"><input type="checkbox" checked={(value as MetadataColumn).sync} onChange={event => update("sync", event.target.checked)} /><span>将该字段的实际取值同步到知识库<small>适用于地区、品类等需要理解具体取值的维度字段。</small></span></label>}
    {editor.kind === "metric" && <fieldset className="adm-fieldset"><legend className="adm-label">关联字段</legend><Field label="筛选可关联字段"><input value={columnFilter} onChange={event => setColumnFilter(event.target.value)} placeholder="表名或字段名" /></Field><div className="adm-reference-list">{[...new Set([...availableColumns, ...(value as MetadataMetric).relevant_columns])].filter(ref => ref.toLowerCase().includes(columnFilter.toLowerCase())).map(ref => <label className="adm-checkbox" key={ref}><input type="checkbox" checked={(value as MetadataMetric).relevant_columns.includes(ref)} onChange={event => update("relevant_columns", event.target.checked ? [...(value as MetadataMetric).relevant_columns, ref] : (value as MetadataMetric).relevant_columns.filter(item => item !== ref))} /><span className="adm-code">{ref}{!availableColumns.includes(ref) && <span className="adm-danger">（字段已不存在，请移除）</span>}</span></label>)}{availableColumns.length === 0 && <Empty>请先添加数据表与字段。</Empty>}</div><p className="adm-muted">已选择 {(value as MetadataMetric).relevant_columns.length} 个关联字段</p></fieldset>}
    <div className="adm-modal-actions"><button type="button" className="adm-btn" onClick={close}>取消</button><button type="submit" className="adm-btn adm-btn-primary">应用到草稿</button></div>
  </form></Modal>;
}

function SchemaImport({ existing, onClose, onImport }: { existing: MetadataTable[]; onClose: () => void; onImport: (tables: SchemaTable[], columns: Set<string>) => void }) {
  const resource = useResource(adminApi.schema);
  const [selection, setSelection] = useState(new Set<string>());
  const [filter, setFilter] = useState("");
  const existingColumns = new Set(existing.flatMap(table => table.columns.map(column => `${table.name}.${column.name}`)));
  const tables = resource.data?.tables.filter(table => table.name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return <Modal title="从数仓导入表结构" onClose={onClose} wide><div className="adm-stack"><Notice>只添加选中的新表与新字段。已有表和字段的描述、角色、别名、值同步设置以及业务指标都会保留。</Notice>
    {resource.loading ? <Loading /> : resource.error ? <LoadError message={resource.error} retry={resource.refresh} /> : <><Field label="搜索数仓表"><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="输入表名" /></Field><div className="adm-import-list">{tables.map(table => {
      const newColumns = table.columns.map(column => `${table.name}.${column.name}`).filter(ref => !existingColumns.has(ref));
      return <details className="adm-import-table" key={table.name}><summary><span>{table.name}</span><span className="adm-muted">{table.columns.length} 个字段 · {newColumns.length} 个可新增</span></summary><label className="adm-checkbox"><input type="checkbox" disabled={!newColumns.length} checked={!!newColumns.length && newColumns.every(ref => selection.has(ref))} onChange={event => setSelection(previous => { const next = new Set(previous); newColumns.forEach(ref => event.target.checked ? next.add(ref) : next.delete(ref)); return next; })} /><span>选择本表全部新字段</span></label>{table.columns.map(column => { const ref = `${table.name}.${column.name}`; const exists = existingColumns.has(ref); return <label className="adm-checkbox" key={ref}><input type="checkbox" disabled={exists} checked={exists || selection.has(ref)} onChange={event => setSelection(previous => { const next = new Set(previous); if (event.target.checked) next.add(ref); else next.delete(ref); return next; })} /><span className="adm-code">{column.name}</span><span className="adm-muted">{exists ? "已存在 · 保留" : column.type}</span></label>; })}</details>;
    })}{!tables.length && <Empty>没有匹配的数仓表。</Empty>}</div><div className="adm-modal-actions"><span className="adm-muted">已选 {selection.size} 个新字段</span><button className="adm-btn" onClick={onClose}>取消</button><button className="adm-btn adm-btn-primary" disabled={!selection.size} onClick={() => onImport(resource.data!.tables, selection)}><Download size={16} />导入到草稿</button></div></>}
  </div></Modal>;
}
