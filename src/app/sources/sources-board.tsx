"use client";
import { useCallback, useEffect, useState } from "react";
import { ScanMenu } from "@/app/components/scan-menu";

type Tier = "core" | "longtail" | "dormant" | "muted";
const TIERS: Tier[] = ["core", "longtail", "dormant", "muted"];
const TIER_LABEL: Record<Tier, string> = { core: "核心·每小时", longtail: "长尾·每天", dormant: "休眠·每周", muted: "静音" };
const FAMILIES = ["greenhouse", "lever", "ashby", "workday", "bytedance", "smartrecruiters", "oracle", "icims", "workable", "amazon", "linkedin", "github_list", "chrome"];

interface FamilySummary { family: string; core: number; longtail: number; dormant: number; muted: number; jobs30: number; ge75_30: number; errors24h: number; }
interface BoardView { key: string; family: string; ident: string; company: string | null; origin: string; tier: Tier; tier_reason: string | null; tier_locked: number; last_polled_at: string | null; last_ok_at: string | null; last_error: string | null; fail_count: number; next_due_at: string | null; jobs30: number; ge75_30: number; }
interface BoardEvent { at: string; key: string; from: string; to: string; reason: string; }
interface Data { families: FamilySummary[]; lastTick: { at: string; payload: { boards: number; inserted: number; errors: { key: string; error: string }[] } } | null; rows: BoardView[]; total: number; pages: number; events: BoardEvent[]; }

function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(ms)) return iso;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function SourcesBoard() {
  const [family, setFamily] = useState("");
  const [tier, setTier] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");


  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (family) params.set("family", family);
    if (tier) params.set("tier", tier);
    if (q) params.set("q", q);
    const r = await fetch(`/api/sources?${params.toString()}`);
    if (r.ok) setData((await r.json()) as Data);
  }, [family, tier, q, page]);

  useEffect(() => { void load(); }, [load]);

  async function act(label: string, fn: () => Promise<Response>) {
    setBusy(label); setMsg("");
    try {
      const r = await fn();
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) setMsg(`${label}失败:${String(j.error ?? r.status)}`);
      else if (label === "导入开源目录") setMsg(`目录导入完成:新增 ${j.inserted} 个板块,已有 ${j.skipped} 个,三天内自动铺开。`);
      else if (label === "立即扫描") setMsg(`扫描完成:新增 ${j.inserted} 个岗位,${(j.sourceErrors as unknown[] | undefined)?.length ?? 0} 个来源出错。`);
      else if (label === "问一次") setMsg(`问过了:新增 ${j.inserted} 个岗位${(j.errors as unknown[] | undefined)?.length ? ",有错误,见板块行" : ""}。`);
      await load();
    } finally { setBusy(""); }
  }
  const setBoardTier = (key: string, t: Tier) => act("改层级", () => fetch("/api/sources/board", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, tier: t }) }));

  return (
    <div>
      <section className="panel">
        <div className="panel-title">按来源家族</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button onClick={() => act("立即扫描", () => fetch("/api/scan", { method: "POST" }))} disabled={!!busy}>{busy === "立即扫描" ? "扫描中…" : "立即扫描(核心 + 清单)"}</button>
          <button className="btn-ghost" onClick={() => act("导入开源目录", () => fetch("/api/sources/import-directory", { method: "POST" }))} disabled={!!busy} title="一次性把开源目录里 4700 多家公司加为长尾板块;再点只补新增">
            {busy === "导入开源目录" ? "导入中…" : "导入开源目录"}
          </button>
          <ScanMenu />
        </div>
        {msg && <p className="text-sub" style={{ marginBottom: 8 }}>{msg}</p>}
        {data?.lastTick && (
          <p className="text-sub" style={{ marginBottom: 8 }}>
            上次检查 {ago(data.lastTick.at)}:问了 {data.lastTick.payload.boards} 个板块,新增 {data.lastTick.payload.inserted} 个岗位,{data.lastTick.payload.errors?.length ?? 0} 个出错。
          </p>
        )}
        <table>
          <thead><tr><th>家族</th><th className="num">核心</th><th className="num">长尾</th><th className="num">休眠</th><th className="num">静音</th><th className="num">30 天新岗</th><th className="num">30 天 ≥75</th><th className="num">24h 出错</th></tr></thead>
          <tbody>
            {(data?.families ?? []).map((f) => (
              <tr key={f.family} style={{ cursor: "pointer" }} onClick={() => { setFamily(f.family); setPage(1); }}>
                <td className="mono">{f.family}</td><td className="num">{f.core}</td><td className="num">{f.longtail}</td><td className="num">{f.dormant}</td><td className="num">{f.muted}</td>
                <td className="num">{f.jobs30}</td><td className="num" style={{ fontWeight: 700 }}>{f.ge75_30}</td><td className={`num${f.errors24h ? " text-accent" : ""}`}>{f.errors24h}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-title">板块</div>
        <div className="queue-toolbar">
          <label style={{ fontSize: 13, color: "var(--sub)" }}>家族{" "}
            <select value={family} onChange={(e) => { setFamily(e.target.value); setPage(1); }}><option value="">全部</option>{FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          </label>
          <label style={{ fontSize: 13, color: "var(--sub)" }}>层级{" "}
            <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }}><option value="">全部</option>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</select>
          </label>
          <input placeholder="搜公司 / key" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ minWidth: 200 }} />
          <div className="pagination">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ 上一页</button>
            <span>第 <span className="mono">{page}</span> / <span className="mono">{data?.pages ?? 1}</span> 页 · 共 <span className="mono">{data?.total ?? 0}</span> 个</span>
            <button className="btn-ghost" disabled={!data || page >= data.pages} onClick={() => setPage(page + 1)}>下一页 ›</button>
          </div>
        </div>
        <table>
          <thead><tr><th>公司 / 板块</th><th>家族</th><th>层级</th><th>上次问</th><th className="num">30 天新岗</th><th className="num">30 天 ≥75</th><th></th></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((b) => (
              <tr key={b.key}>
                <td>
                  <div className="company">{b.company ?? b.ident}</div>
                  <div className="mono text-sub" style={{ fontSize: 11 }}>{b.key}{b.tier_locked ? " · 手动" : ""}{b.origin === "seed" ? " · 种子" : b.origin === "directory" ? " · 目录" : b.origin === "url" ? " · 链接发现" : ""}</div>
                </td>
                <td className="mono">{b.family}</td>
                <td>
                  <select value={b.tier} onChange={(e) => setBoardTier(b.key, e.target.value as Tier)} disabled={!!busy || b.family === "chrome"}>
                    {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                  </select>
                  {b.tier_reason && <div className="text-sub" style={{ fontSize: 11 }}>{b.tier_reason}</div>}
                </td>
                <td>
                  <span title={b.last_polled_at ?? undefined}>{ago(b.last_polled_at)}</span>
                  {b.last_error && <div className="text-accent" style={{ fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.last_error}>{b.last_error}</div>}
                </td>
                <td className="num">{b.jobs30}</td>
                <td className="num" style={{ fontWeight: 700 }}>{b.ge75_30}</td>
                <td className="row-actions">
                  {b.family !== "chrome" && <button className="btn-ghost" disabled={!!busy} onClick={() => act("问一次", () => fetch("/api/sources/poll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: b.key }) }))}>问一次</button>}
                  {b.family !== "chrome" && (b.tier === "muted"
                    ? <button className="btn-ghost" disabled={!!busy} onClick={() => setBoardTier(b.key, "longtail")}>恢复</button>
                    : <button className="btn-ghost" disabled={!!busy} onClick={() => setBoardTier(b.key, "muted")}>静音</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-title">最近升降级</div>
        {(data?.events ?? []).length === 0 ? <p className="text-sub">还没有记录。</p> : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
            {(data?.events ?? []).map((e, i) => (
              <li key={i} style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                <span className="mono text-sub">{e.at}</span>{" "}<span className="mono">{e.key}</span>{" "}{e.from} → <strong>{e.to}</strong>{" "}<span className="text-sub">({e.reason})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
