"use client";
import { useCallback, useEffect, useState } from "react";

// 「Chrome 扫描」:排一个 scan 类型的 run(仅值守会话)。值守会话接单后在用户登录的 Chrome 里只读地搜
// LinkedIn / Handshake / Tesla,把新岗经 /api/scan/ingest 抄回来。已有排队/运行中的 run 时按钮禁用。
interface RunRow { id: number; kind: string; status: string; summary: string | null; }

export function ChromeScanButton({ showSummary = false }: { showSummary?: boolean }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/executor/status");
      if (!r.ok) return;
      const j = (await r.json()) as { runs?: RunRow[] };
      setRun((j.runs ?? []).find((x) => x.kind === "scan") ?? null);
    } catch { /* 状态拉不到不影响页面 */ }
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  async function start() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/executor/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "scan", channel: "user_chrome", options: {} }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setMsg(r.ok ? "已排队,值守会话接单后会在你的 Chrome 里开始找岗。" : `没排上:${j.error ?? r.status}`);
      await load();
    } finally { setBusy(false); }
  }

  const active = run?.status === "queued" || run?.status === "running";
  const label = run?.status === "queued" ? `Chrome 扫描:排队中(run #${run.id})` : run?.status === "running" ? `Chrome 扫描:运行中(run #${run.id})` : "Chrome 扫描(LinkedIn / Handshake / Tesla)";
  return (
    <>
      <button className="btn-ghost" onClick={start} disabled={busy || active} title="值守会话在你登录的 Chrome 里只读地搜 LinkedIn / Handshake / Tesla,把新岗抄回来入库;不点 Apply、不发消息">
        {label}
      </button>
      {msg && <span className="text-sub" style={{ marginLeft: 8 }}>{msg}</span>}
      {showSummary && run && !active && run.summary && <span className="text-sub" style={{ marginLeft: 8 }}>上次(run #{run.id},{run.status}):{run.summary}</span>}
    </>
  );
}
