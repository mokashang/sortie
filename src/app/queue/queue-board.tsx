"use client";
import { Fragment, useCallback, useRef, useState } from "react";
import { directionLabel } from "@/matcher/directions";

export type QueueSort = "score" | "fresh" | "company";

interface TabInfo {
  direction: string;
  tier: number | null;
  matched: number;
}

interface QueueRow {
  id: number;
  company: string;
  title: string;
  location: string | null;
  apply_url: string | null;
  direction: string | null;
  score: number | null;
  tier: number | null;
  reason: string | null;
  posted_at: string | null;
  pinned: number;
}

interface PagedResult {
  rows: QueueRow[];
  total: number;
  pages: number;
}

interface JobDetail {
  title: string;
  company: string;
  location: string | null;
  apply_url: string | null;
  jd_text: string | null;
  match: { direction: string | null; score: number | null; tier: number | null; reason: string | null };
  resume_version: string | null;
}

type JdState = { status: "loading" } | { status: "ready"; data: JobDetail } | { status: "error"; message: string };

interface UndoEntry {
  jobId: number;
  company: string;
  title: string;
}

// Splits the semicolon-separated location string jobs.location stores into individual cities and
// keeps only the first 3 for display — some postings list 20-30 cities, which made every /queue
// row absurdly tall. The full list is still available on hover via the title attribute.
function truncateLocations(location: string | null): { display: string; full: string } {
  if (!location) return { display: "—", full: "" };
  const parts = location.split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 3) return { display: parts.join("; "), full: location };
  return { display: `${parts.slice(0, 3).join("; ")} +${parts.length - 3}`, full: location };
}

export function QueueBoard({
  tabs: initialTabs,
  initialDirection,
  initialPage,
  initialSort,
  initialResult,
  pageSize,
}: {
  tabs: TabInfo[];
  initialDirection: string;
  initialPage: number;
  initialSort: QueueSort;
  initialResult: PagedResult;
  pageSize: number;
}) {
  const [tabs, setTabs] = useState<TabInfo[]>(initialTabs);
  const [direction, setDirection] = useState(initialDirection);
  const [page, setPage] = useState(initialPage);
  const [sort, setSort] = useState<QueueSort>(initialSort);
  const [result, setResult] = useState<PagedResult>(initialResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [undos, setUndos] = useState<UndoEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [jdCache, setJdCache] = useState<Map<number, JdState>>(new Map());
  const [pinBusy, setPinBusy] = useState<Set<number>>(new Set());
  const undoTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  function updateUrl(d: string, p: number, s: QueueSort) {
    const params = new URLSearchParams({ direction: d, page: String(p), sort: s });
    window.history.replaceState(null, "", `/queue?${params.toString()}`);
  }

  const fetchPage = useCallback(
    async (d: string, p: number, s: QueueSort) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ direction: d, page: String(p), pageSize: String(pageSize), sort: s });
        const r = await fetch(`/api/queue?${params.toString()}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as PagedResult;
        setResult(j);
      } catch (e) {
        setError(`加载队列失败:${e}`);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  const fetchTabs = useCallback(async () => {
    try {
      const r = await fetch("/api/queue/by-direction");
      if (!r.ok) return;
      const j = await r.json();
      setTabs(j.groups ?? []);
    } catch {
      // stale counts are non-fatal — the row-level state is still correct.
    }
  }, []);

  function selectTab(d: string) {
    if (d === direction) return;
    setDirection(d);
    setPage(1);
    updateUrl(d, 1, sort);
    fetchPage(d, 1, sort);
  }

  function goToPage(p: number) {
    const clamped = Math.min(Math.max(1, p), result.pages);
    if (clamped === page) return;
    setPage(clamped);
    updateUrl(direction, clamped, sort);
    fetchPage(direction, clamped, sort);
  }

  function changeSort(s: QueueSort) {
    setSort(s);
    setPage(1);
    updateUrl(direction, 1, s);
    fetchPage(direction, 1, s);
  }

  async function archiveRow(jobId: number) {
    const row = result.rows.find((r) => r.id === jobId);
    if (!row) return;
    setResult((prev) => ({
      rows: prev.rows.filter((r) => r.id !== jobId),
      total: Math.max(0, prev.total - 1),
      pages: prev.pages,
    }));
    setUndos((prev) => [...prev, { jobId, company: row.company, title: row.title }]);
    try {
      const r = await fetch("/api/queue/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!r.ok) throw new Error(String(r.status));
      fetchTabs();
      const timer = setTimeout(() => {
        setUndos((prev) => prev.filter((u) => u.jobId !== jobId));
        undoTimers.current.delete(jobId);
      }, 8000);
      undoTimers.current.set(jobId, timer);
    } catch (e) {
      setError(`跳过失败:${e}`);
      setUndos((prev) => prev.filter((u) => u.jobId !== jobId));
      fetchPage(direction, page, sort);
    }
  }

  async function undoArchive(jobId: number) {
    const timer = undoTimers.current.get(jobId);
    if (timer) clearTimeout(timer);
    undoTimers.current.delete(jobId);
    setUndos((prev) => prev.filter((u) => u.jobId !== jobId));
    try {
      const r = await fetch("/api/queue/unarchive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!r.ok) throw new Error(String(r.status));
      fetchPage(direction, page, sort);
      fetchTabs();
    } catch (e) {
      setError(`撤销失败:${e}`);
    }
  }

  async function togglePin(jobId: number, pinned: boolean) {
    setPinBusy((prev) => new Set(prev).add(jobId));
    try {
      const r = await fetch("/api/queue/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, pinned }),
      });
      if (!r.ok) throw new Error(String(r.status));
      await fetchPage(direction, page, sort);
    } catch (e) {
      setError(`置顶操作失败:${e}`);
    } finally {
      setPinBusy((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  }

  async function toggleExpand(jobId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
    if (jdCache.has(jobId)) return;
    setJdCache((prev) => new Map(prev).set(jobId, { status: "loading" }));
    try {
      const r = await fetch(`/api/jobs/${jobId}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as JobDetail;
      setJdCache((prev) => new Map(prev).set(jobId, { status: "ready", data }));
    } catch (e) {
      setJdCache((prev) => new Map(prev).set(jobId, { status: "error", message: String(e) }));
    }
  }

  return (
    <div>
      <div className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.direction}
            className={`tab ${t.direction === direction ? "active" : ""}`}
            onClick={() => selectTab(t.direction)}
          >
            {directionLabel(t.direction)} <span className="chip">梯队 {t.tier ?? "—"}</span>
            <span className="tab-count">{t.matched}</span>
          </button>
        ))}
      </div>

      {undos.length > 0 && (
        <div>
          {undos.map((u) => (
            <div className="undo-strip" key={u.jobId}>
              <span>
                已跳过 <strong className="company-name">{u.company}</strong> · {u.title}
              </span>
              <button className="btn-ghost" onClick={() => undoArchive(u.jobId)}>
                撤销
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-accent" style={{ marginBottom: 10 }}>{error}</p>}

      <div className="queue-toolbar">
        <div className="pagination">
          <button className="btn-ghost" disabled={loading || page <= 1} onClick={() => goToPage(page - 1)}>
            ‹ 上一页
          </button>
          <span>
            第 <span className="mono">{page}</span> / <span className="mono">{result.pages}</span> 页 · 共{" "}
            <span className="mono">{result.total}</span> 条
          </span>
          <button className="btn-ghost" disabled={loading || page >= result.pages} onClick={() => goToPage(page + 1)}>
            下一页 ›
          </button>
        </div>
        <label style={{ fontSize: 13, color: "var(--sub)" }}>
          排序{" "}
          <select value={sort} onChange={(e) => changeSort(e.target.value as QueueSort)} disabled={loading}>
            <option value="score">分数</option>
            <option value="fresh">新鲜度</option>
            <option value="company">公司名</option>
          </select>
        </label>
      </div>

      {result.rows.length === 0 ? (
        <p className="text-sub">{loading ? "加载中…" : "该方向暂无队列职位。"}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="num">分</th>
              <th>公司</th>
              <th>标题</th>
              <th>地点</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const loc = truncateLocations(r.location);
              const isExpanded = expanded.has(r.id);
              const jd = jdCache.get(r.id);
              const isPinBusy = pinBusy.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {r.pinned ? <span className="chip pin-chip">★</span> : null}
                      {r.score ?? "—"}
                    </td>
                    <td className="company">{r.company}</td>
                    <td>{r.title}</td>
                    <td title={loc.full || undefined}>{loc.display}</td>
                    <td className="row-actions">
                      {r.apply_url && (
                        <a href={r.apply_url} target="_blank" rel="noreferrer" className="btn-ghost">
                          申请
                        </a>
                      )}
                      <button className="btn-ghost" onClick={() => toggleExpand(r.id)}>
                        {isExpanded ? "收起" : "展开"}
                      </button>
                      <button className="btn-ghost" disabled={isPinBusy} onClick={() => togglePin(r.id, !r.pinned)}>
                        {r.pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button className="btn-ghost" onClick={() => archiveRow(r.id)}>
                        跳过
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0, borderBottom: "1px solid var(--line)" }}>
                        <div className="jd-drawer">
                          {!jd || jd.status === "loading" ? (
                            <p className="text-sub">加载中…</p>
                          ) : jd.status === "error" ? (
                            <p className="text-accent">加载失败:{jd.message}</p>
                          ) : (
                            <>
                              <h4>打分理由</h4>
                              <p className="text-sub" style={{ fontSize: 13, marginBottom: 6 }}>
                                {jd.data.match.direction ? directionLabel(jd.data.match.direction) : "未分类"} · 梯队{" "}
                                {jd.data.match.tier ?? "—"} · 分 {jd.data.match.score ?? "—"}
                                {jd.data.resume_version ? ` · 简历版本 ${jd.data.resume_version}` : ""}
                              </p>
                              <p style={{ fontSize: 13, marginBottom: 12 }}>{jd.data.match.reason ?? "(无理由记录)"}</p>
                              <h4>JD</h4>
                              <pre>{jd.data.jd_text ?? "(无 JD 文本)"}</pre>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
