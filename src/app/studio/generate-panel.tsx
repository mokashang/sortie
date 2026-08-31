"use client";
import { useState } from "react";

const DIRECTIONS = ["swe_general","swe_backend","ai_infra","mle","quant","embedded","systems_perf","robotics","sre_infra","data","security","gpu_cuda"];

export function GeneratePanel() {
  const [dir, setDir] = useState("swe_general");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function gen() {
    setBusy(true); setMsg("生成中(Claude 选料 + 编译,约 20-40 秒)…");
    try {
      const r = await fetch("/api/resumes/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction: dir, versionName: name || undefined }) });
      const j = await r.json();
      if (!r.ok) { setMsg("失败:" + (j.error || r.status)); return; }
      setMsg("完成!下方列表刷新查看");
      setTimeout(() => location.reload(), 1200);
    } catch (e) { setMsg("失败:" + e); } finally { setBusy(false); }
  }
  return (
    <div style={{ background: "#fff", padding: 16, borderRadius: 8, margin: "12px 0" }}>
      <h3>生成一版简历</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <select value={dir} onChange={(e) => setDir(e.target.value)}>{DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <input placeholder="版本名(可选)" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={gen} disabled={busy}>生成</button>
        <span style={{ color: "#666" }}>{msg}</span>
      </div>
    </div>
  );
}
