/**
 * React 应用入口
 * 挂载根组件并加载全局样式
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
