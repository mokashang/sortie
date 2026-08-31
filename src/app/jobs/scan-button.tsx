"use client";
import { useState } from "react";

export function ScanButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function scan() {
    setBusy(true);
    setMsg("扫描中…");
    try {
      const r = await fetch("/api/scan", { method: "POST" });
      const s = await r.json();
      setMsg(`完成:+${s.inserted} 新职位,${s.upgraded} 升级,${s.duplicates} 重复,${s.sourceErrors.length} 源错误`);
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setMsg(`失败:${e}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <p style={{ margin: "12px 0" }}>
      <button onClick={scan} disabled={busy}>立即扫描</button> <span>{msg}</span>
    </p>
  );
}
