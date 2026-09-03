"use client";
import { useCallback, useEffect, useState } from "react";
import { ApplyQuotaTable } from "@/app/apply/quota-table";

export type ExecutorKind = "apply" | "network_send" | "network_find";

export interface ExecutorKindConfig {
  kind: ExecutorKind;
  label: string; // start-button text
  // Shows a "前 N 个" number input next to the button and passes { limit } as options.
  withLimit?: boolean;
  // apply-only: swaps the input+button for the per-direction quota table (quota-table.tsx),
  // which drives its own "开始投递" button and passes { plan } as options instead of { limit }.
  quotaTable?: boolean;
}

interface RunRow {
  id: number;
  kind: string;
  status: string;
  channel: string;
  pid: number | null;
  logPath: string | null;
  options: unknown;
  summary: string | null;
  startedAt: string;
  claimedAt: string | null;
  endedAt: string | null;
  logTail?: string[];
}

const STATUS_LABELS: Record<string, string> = {
  queued: "已排队",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

const CHANNEL_LABELS: Record<string, string> = {
  user_chrome: "值守会话",
  headless: "无人值守",
};

// "swe_general ×2 · mle ×1" / "恢复模式" / "前 5 个" — a one-line description of what a run was
// asked to do, from its stored options.
function describeOptions(options: unknown): string {
  const o = (options ?? {}) as {
    plan?: { direction: string; count: number; mode?: string }[];
    limit?: number;
    resume?: boolean;
    companies?: string[];
    jobIds?: number[];
    mode?: string;
  };
  const parts: string[] = [];
  if (o.resume) parts.push("恢复模式(补提交已批准/补发已批准内推消息)");
  if (Array.isArray(o.plan) && o.plan.length > 0)
    parts.push(o.plan.map((p) => `${p.direction}${p.mode === "referral" ? "·内推" : ""} ×${p.count}`).join(" · "));
  else if (o.limit != null) parts.push(`前 ${o.limit} 个`);
  if (Array.isArray(o.jobIds) && o.jobIds.length > 0)
    parts.push(`${o.mode === "referral" ? "找内推" : "直投"} 岗位 #${o.jobIds.join(",#")}`);
  if (Array.isArray(o.companies) && o.companies.length > 0) parts.push(o.companies.join(", "));
  return parts.join(" · ");
}

// sqlite datetime('now') is UTC without a marker; render in the browser's local time as MM-DD HH:MM.
function localShort(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(`${ts.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The full step-by-step log of one run (GET /api/executor/log?id=) — the "详情" view. Re-fetches
// every 3s while the run is still in flight so the user can watch each step land; a finished
// run is fetched once.
function RunLogView({ runId, live }: { runId: number; live: boolean }) {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/executor/log?id=${runId}`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setLines(j.lines ?? []);
      } catch {
        // keep last known lines
      }
    }
    load();
    if (!live) return () => { cancelled = true; };
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runId, live]);

  return (
    <pre
      style={{
        marginTop: 6,
        maxHeight: 360,
        overflowY: "auto",
        background: "var(--chip-bg)",
        padding: 8,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        fontSize: 12,
      }}
    >
      {lines === null ? "加载中…" : lines.length === 0 ? "(暂无输出)" : lines.join("\n")}
    </pre>
  );
}

// Shared "start a headless executor session from a button" panel for /apply and /network. Both
// pages configure it with the executor kind(s) relevant to that page (see kinds prop) so the
// component itself doesn't need to know which page it's on. Polls /api/executor/status every 3s
// so a run started from another tab/window (or a run this panel itself started) shows live
// progress without a page reload.
export function ExecutorPanel({ kinds }: { kinds: ExecutorKindConfig[] }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>(
    Object.fromEntries(kinds.filter((k) => k.withLimit).map((k) => [k.kind, 5]))
  );
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  // Which channel new runs start on. Defaults to 值守会话 (user_chrome) — the App's default: an
  // already-open interactive Claude Code session with the claude-in-chrome extension attached to
  // the user's own logged-in Chrome claims queued runs and drives that browser itself. The
  // alternative, 无人值守 (headless), spawns `claude -p` against a separate persistent Chrome
  // profile — see the 打开浏览器档案 button below, which only makes sense for that channel.
  const [channel, setChannel] = useState<"user_chrome" | "headless">("user_chrome");
  // Run ids whose full log ("详情") is expanded — the in-flight run's block and the run-history
  // list below share this so expanding in one place shows in both.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openProfile() {
    setBusyKind("open-profile");
    setProfileMsg("");
    setError("");
    try {
      const r = await fetch("/api/executor/open-profile", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(`打开浏览器档案失败:${j.error ?? r.status}`);
        return;
      }
      setProfileMsg("已打开一个 Chrome 窗口(专属浏览器档案)——在里面登录一次 LinkedIn/Workday 等站点即可,登录状态会保留给之后的无人值守执行器使用。");
    } catch (e) {
      setError(`打开浏览器档案失败:${e}`);
    } finally {
      setBusyKind(null);
    }
  }

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/executor/status");
      if (!r.ok) return;
      const j = await r.json();
      setRuns(j.runs ?? []);
    } catch {
      // transient network hiccup during polling — keep showing the last known list
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // Most recent run for each configured kind — used to decide whether that kind's start button
  // should be disabled (a run of that kind is currently running) and what to show underneath it.
  const latestByKind: Record<string, RunRow | undefined> = {};
  for (const { kind } of kinds) {
    latestByKind[kind] = runs.find((r) => r.kind === kind);
  }

  async function startWithOptions(kind: ExecutorKind, options: Record<string, unknown>) {
    setBusyKind(kind);
    setError("");
    try {
      const r = await fetch("/api/executor/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, options, channel }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(`启动失败:${j.error ?? r.status}`);
        return;
      }
      await refresh();
    } catch (e) {
      setError(`启动失败:${e}`);
    } finally {
      setBusyKind(null);
    }
  }

  async function start(kind: ExecutorKind, withLimit?: boolean) {
    const options = withLimit ? { limit: limits[kind] ?? 5 } : {};
    await startWithOptions(kind, options);
  }

  async function stop(runId: number) {
    setBusyKind(`stop-${runId}`);
    setError("");
    try {
      const r = await fetch("/api/executor/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(`停止失败:${j.error ?? r.status}`);
        return;
      }
      await refresh();
    } catch (e) {
      setError(`停止失败:${e}`);
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <div className="panel">
      {error && <p className="text-accent">{error}</p>}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="radio"
              name="executor-channel"
              checked={channel === "user_chrome"}
              onChange={() => setChannel("user_chrome")}
            />
            用我的 Chrome(值守会话)【默认】
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="radio"
              name="executor-channel"
              checked={channel === "headless"}
              onChange={() => setChannel("headless")}
            />
            无人值守(专属浏览器档案)
          </label>
        </div>
        <p className="text-sub" style={{ fontSize: 12, margin: "6px 0 0" }}>
          {channel === "user_chrome"
            ? "开始投递后,任务会排队等待一个已经打开、连了 claude-in-chrome 扩展的交互式 Claude Code 会话(值守会话)来接手——它会在你自己已登录的 Chrome 里逐个操作,你可以随时看着它做。"
            : "开始投递后,App 会直接启动一个 headless 执行器,在下面这个专属的、持久化的 Chrome 档案里无人值守地操作——不是你日常登录的浏览器,需要先登录一次。"}
        </p>
      </div>
      {channel === "headless" && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn-ghost" onClick={openProfile} disabled={busyKind === "open-profile"}>
            打开浏览器档案(登录一次)
          </button>
          <p className="text-sub" style={{ fontSize: 12, margin: "4px 0 0" }}>
            执行器用的是一个专属的持久化 Chrome 档案,不是你日常用的浏览器——第一次用前(或换了账号密码后)点这个按钮,在弹出的窗口里登录一次 LinkedIn/Workday 等站点,登录状态会保留给之后的无人值守执行器使用。
          </p>
          {profileMsg && (
            <p className="text-sub" style={{ fontSize: 12, marginTop: 4 }}>
              {profileMsg}
            </p>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {kinds.map(({ kind, label, withLimit, quotaTable }) => {
          const run = latestByKind[kind];
          const isRunning = run?.status === "running";
          const isQueued = run?.status === "queued";
          const busy = isRunning || isQueued || busyKind === kind;
          return (
            <div key={kind} style={{ flex: quotaTable ? "1 1 100%" : "1 1 320px", minWidth: 280 }}>
              {quotaTable ? (
                <div>
                  <ApplyQuotaTable
                    disabled={busy}
                    onStart={(plan) => startWithOptions(kind, { plan })}
                  />
                  {busy && run && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="btn-ghost"
                        onClick={() => stop(run.id)}
                        disabled={busyKind === `stop-${run.id}`}
                      >
                        停止
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {withLimit && (
                    <>
                      <span className="text-sub" style={{ fontSize: 13 }}>前</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={limits[kind] ?? 5}
                        onChange={(e) => setLimits((prev) => ({ ...prev, [kind]: Number(e.target.value) || 1 }))}
                        disabled={busy}
                        style={{ width: 56 }}
                      />
                      <span className="text-sub" style={{ fontSize: 13 }}>个</span>
                    </>
                  )}
                  <button onClick={() => start(kind, withLimit)} disabled={busy}>
                    {label}
                  </button>
                  {busy && run && (
                    <button className="btn-ghost" onClick={() => stop(run.id)} disabled={busyKind === `stop-${run.id}`}>
                      停止
                    </button>
                  )}
                </div>
              )}

              {run && (
                <div className="text-sub" style={{ marginTop: 8, fontSize: 13 }}>
                  {run.channel === "user_chrome" && isQueued ? (
                    <span>已排队,等待值守会话接手…(run #{run.id})</span>
                  ) : run.channel === "user_chrome" && isRunning ? (
                    <span>
                      值守会话执行中 · run #{run.id}
                      {(run.logTail ?? []).length > 0 ? ` · 最近: ${run.logTail![run.logTail!.length - 1]}` : ""}
                    </span>
                  ) : (
                    <span>
                      #{run.id} · {STATUS_LABELS[run.status] ?? run.status}
                      {run.pid != null ? ` · pid ${run.pid}` : ""}
                    </span>
                  )}
                  {run.summary && <p style={{ margin: "4px 0", color: "var(--ink)" }}>{run.summary}</p>}
                  {(isRunning || isQueued) && (
                    <div style={{ marginTop: 6 }}>
                      <button
                        className="btn-ghost"
                        onClick={() => toggleExpanded(run.id)}
                        style={{ fontSize: 12, padding: "3px 10px" }}
                      >
                        {expanded.has(run.id) ? "收起详情" : "查看详情(每一步)"}
                      </button>
                      {expanded.has(run.id) ? (
                        <RunLogView runId={run.id} live />
                      ) : (
                        <pre
                          style={{
                            marginTop: 6,
                            maxHeight: 120,
                            overflowY: "auto",
                            background: "var(--chip-bg)",
                            padding: 8,
                            lineHeight: 1.4,
                            whiteSpace: "pre-wrap",
                            fontSize: 12,
                          }}
                        >
                          {(run.logTail ?? []).slice(-4).join("\n") || "(暂无输出)"}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {runs.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary>运行记录(最近 {runs.length} 次)</summary>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>类型</th>
                <th>通道</th>
                <th>任务</th>
                <th>状态</th>
                <th>开始</th>
                <th>结束</th>
                <th>结果</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const live = r.status === "running" || r.status === "queued";
                const open = expanded.has(r.id);
                return [
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>{r.kind}</td>
                    <td className="text-sub" style={{ fontSize: 12 }}>{CHANNEL_LABELS[r.channel] ?? r.channel}</td>
                    <td className="text-sub" style={{ fontSize: 12 }}>{describeOptions(r.options) || "—"}</td>
                    <td className={r.status === "failed" ? "text-accent" : r.status === "done" ? "text-good" : ""}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </td>
                    <td className="mono text-sub" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{localShort(r.startedAt)}</td>
                    <td className="mono text-sub" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{localShort(r.endedAt)}</td>
                    <td className="text-sub" style={{ fontSize: 12, maxWidth: 360 }}>{r.summary ?? ""}</td>
                    <td>
                      <button className="btn-ghost" onClick={() => toggleExpanded(r.id)} style={{ fontSize: 12, padding: "3px 10px" }}>
                        {open ? "收起" : "详情"}
                      </button>
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${r.id}-log`}>
                      <td colSpan={9} style={{ padding: "0 0 10px" }}>
                        <RunLogView runId={r.id} live={live} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
