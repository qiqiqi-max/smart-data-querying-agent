/**
 * 浏览器能力封装
 * 提供文件下载、剪贴板复制以及复制成功的短暂提示状态
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function downloadText(fileName: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 下载已经触发，稍后释放对象地址
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 复制成功后返回 true 并保持 1.5 秒，用来切换按钮上的“已复制”提示
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.alert("复制失败，请检查浏览器的剪贴板权限。");
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }, []);

  return { copied, copy };
}
