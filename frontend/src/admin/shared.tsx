import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void load(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Request identity is described by explicit dependencies and refresh version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, version]);
  return { data, setData, error, loading, refresh: () => setVersion(value => value + 1) };
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试。"; }
export function useDirty(dirty: boolean, onDirty: (value: boolean) => void) {
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
}
export function navigateTabs(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index = tabs.findIndex(tab => tab === document.activeElement);
  if (index < 0) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
}
export function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
export function shortRevision(value: string | null) { return value ? value.slice(0, 10) : "尚无版本记录"; }
const labels: Record<string, string> = { ready: "可用", unconfigured: "未配置", queued: "排队中", running: "执行中", done: "已完成", error: "失败", stopped: "已停止", clarify: "待补充", unsupported: "数据不足", interrupted: "已中断", success: "成功", failed: "失败" };
export function Badge({ value, children }: { value: string; children?: ReactNode }) {
  return <span className={`adm-badge adm-badge-${value}`}>{children ?? labels[value] ?? value}</span>;
}
export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "error" | "success" | "info" | "warning" }) {
  return <div className={`adm-notice adm-notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{kind === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<div>{children}</div></div>;
}
export function Loading({ label = "正在读取…" }: { label?: string }) { return <div className="adm-loading" role="status"><LoaderCircle size={20} className="adm-spin" />{label}</div>; }
export function LoadError({ message, retry }: { message: string; retry: () => void }) { return <Notice kind="error"><span>{message}</span><button className="adm-btn adm-btn-small" onClick={retry}><RefreshCw size={15} />重新加载</button></Notice>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="adm-empty">{children}</div>; }
export function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="adm-section"><div className="adm-section-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLLabelElement>(null);
  useLayoutEffect(() => {
    const input = ref.current?.querySelector("input,select,textarea");
    input?.setAttribute("aria-labelledby", `${id}-label`);
    if (hint) input?.setAttribute("aria-describedby", `${id}-hint`);
  }, [id, hint]);
  return <label ref={ref} className="adm-field"><span id={`${id}-label`}>{label}</span>{children}{hint && <small id={`${id}-hint`}>{hint}</small>}</label>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const hidden: HTMLElement[] = [];
    let branch: HTMLElement | null = el?.parentElement ?? null;
    while (branch && branch !== document.body) {
      for (const sibling of Array.from(branch.parentElement?.children ?? [])) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          hidden.push(sibling);
        }
      }
      branch = branch.parentElement;
    }
    el?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab" || !el) return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]'));
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === el)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === el)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); hidden.forEach(item => { item.inert = false; }); previous?.focus(); };
  }, []);
  return <div className="adm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`adm-modal${wide ? " adm-modal-wide" : ""}`} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="adm-modal-head"><h2>{title}</h2><button className="adm-icon-btn" aria-label="关闭对话框" onClick={onClose}><X size={20} /></button></div><div className="adm-modal-content">{children}</div></div></div>;
}
