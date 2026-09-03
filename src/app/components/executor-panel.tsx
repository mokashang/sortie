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
                    <pre
                      style={{
                        marginTop: 6,
                        maxHeight: 180,
                        overflowY: "auto",
                        background: "var(--chip-bg)",
                        padding: 8,
                        lineHeight: 1.4,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {(run.channel === "user_chrome" ? (run.logTail ?? []).slice(-5) : run.logTail ?? []).join("\n") ||
                        "(暂无输出)"}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
