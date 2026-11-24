import { Suspense, lazy, useEffect, useState } from "react";
import App from "./App";

const AdminApp = lazy(() => import("./admin/AdminApp"));

export default function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const navigate = () => {
      const next = window.location.hash;
      const admin = document.querySelector<HTMLElement>("[data-admin-dirty]");
      if (!next.startsWith("#/admin") && admin?.dataset.adminDirty === "true"
        && !window.confirm("有尚未保存的更改，离开管理台后将丢失。确定离开吗？")) {
        window.history.replaceState(null, "", "#/admin");
        return;
      }
      setHash(next);
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return hash.startsWith("#/admin")
    ? <Suspense fallback={<div className="p-8 text-sm text-slate-700">正在加载管理台…</div>}><AdminApp /></Suspense>
    : <App />;
}
