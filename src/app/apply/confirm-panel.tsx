"use client";
import { useEffect, useState, useCallback } from "react";
import { directionLabel } from "@/matcher/directions";

interface PendingRow {
  jobId: number;
  company: string;
  title: string;
  direction: string | null;
  tier: number | null;
  score: number | null;
  filledFields: Record<string, string>;
  resumeVersion: string | null;
  decision: string | null;
  referralPersonName: string | null;
}

interface ExecutorRunRow {
  id: number;
  kind: string;
  status: string;
  startedAt: string;
  logTail?: string[];
}

// filledFields is meant to be Record<string, string>, but it round-trips through unvalidated
// JSON from the executor's HTTP report — src/apply/queue.ts's reportFill coerces non-string
// values before persisting, but this is a second, independent guard on the render side: React
// throws if asked to render a raw object/array as a child, which would take down the entire
// approval UI (every other card too) for one bad value. String() never throws.
function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    return "";
  }
}

// executor_runs.started_at is sqlite's datetime('now') — UTC "YYYY-MM-DD HH:MM:SS" with no
// timezone marker — so it must be parsed as UTC explicitly, or a browser in a non-UTC timezone
// would read it as local time and show a wildly wrong elapsed duration.
function minutesSince(startedAt: string): number {
  const t = new Date(`${startedAt.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

// Confirmation queue: polls /api/apply/pending every 3s so a card disappears on its own once
// the executor (or another browser tab) moves the application past awaiting_confirm — either
// because this user approved+submitted it, or because a decision was made elsewhere. Also polls
// /api/executor/status every 3s (same endpoint executor-panel.tsx uses, which reaps stale
// 'running' rows before responding) so the confirm queue can answer the question the user
// actually has when they land here: "if I click 确认提交, will anything actually happen?" —
// before this, an approval with no executor alive just sat in the DB forever with no feedback.
export function ConfirmPanel() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [executorRun, setExecutorRun] = useState<ExecutorRunRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/apply/pending");
      if (!r.ok) return;
      const j = await r.json();
      setRows(j.pending ?? []);
    } catch {
      // transient network hiccup during polling — keep showing the last known list
    }
  }, []);

  const refreshExecutor = useCallback(async () => {
    try {
      const r = await fetch("/api/executor/status");
      if (!r.ok) return;
      const j = await r.json();
      const runs: ExecutorRunRow[] = j.runs ?? [];
      setExecutorRun(runs.find((run) => run.kind === "apply") ?? null);
    } catch {
      // transient network hiccup during polling — keep showing the last known state
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    refreshExecutor();
    const id = setInterval(refreshExecutor, 3000);
    return () => clearInterval(id);
  }, [refreshExecutor]);

  async function decide(jobId: number, decision: "approve" | "reject") {
    let reason: string | undefined;
    if (decision === "reject") {
      reason = window.prompt("拒绝原因(可选)") ?? undefined;
    }
    setBusyId(jobId);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/apply/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, decision, reason }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(`操作失败:${j.error ?? r.status}`);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (j.autoStarted) {
        setNotice(`已自动启动执行器完成提交(run #${j.runId})。`);
        refreshExecutor();
      }
      await refresh();
    } catch (e) {
      setError(`操作失败:${e}`);
    } finally {
      setBusyId(null);
    }
  }

  const executorRunning = executorRun?.status === "running";
  const logTail = (executorRun?.logTail ?? []).slice(-3);

  const statusStrip = executorRunning ? (
    <div className="panel" style={{ marginBottom: 12, padding: "10px 14px" }}>
      <span className="chip">
        执行器:运行中(run #{executorRun!.id},已运行 {minutesSince(executorRun!.startedAt)} 分钟)
      </span>
      {logTail.length > 0 && (
        <pre
          style={{
            marginTop: 8,
            background: "var(--chip-bg)",
            padding: 8,
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {logTail.join("\n")}
        </pre>
      )}
    </div>
  ) : (
    <div className="panel" style={{ marginBottom: 12, padding: "10px 14px" }}>
      <span className="text-warn" style={{ fontWeight: 600 }}>
        执行器:未运行 — 批准后不会有人提交,请点上方「开始投递」
      </span>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div>
        {statusStrip}
        <p className="text-sub">暂无待确认的申请。执行器会话完成填表后会出现在这里。</p>
      </div>
    );
  }

  return (
    <div>
      {statusStrip}
      {notice && <p className="text-good">{notice}</p>}
      {error && <p className="text-accent">{error}</p>}
      {rows.map((r) => (
        <div key={r.jobId} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <strong className="company-name">{r.company}</strong> · {r.title}
              <span className="chip" style={{ marginLeft: 8 }}>
                {r.direction ? directionLabel(r.direction) : "未分类"} · 梯队 {r.tier ?? "—"}
              </span>
              <span className="text-sub" style={{ marginLeft: 8 }}>
                分 <span className="mono">{r.score ?? "—"}</span>
              </span>
              {r.referralPersonName && (
                <span className="text-good" style={{ fontWeight: 600, marginLeft: 8 }}>
                  带内推 · {r.referralPersonName}
                </span>
              )}
            </div>
            <div className="text-sub" style={{ fontSize: 13 }}>简历版本:{r.resumeVersion ?? "—"}</div>
          </div>

          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>字段</th>
                <th>填入值</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.filledFields).length === 0 ? (
                <tr>
                  <td colSpan={2} className="text-sub">
                    (执行器未回报任何字段)
                  </td>
                </tr>
              ) : (
                Object.entries(r.filledFields).map(([field, value]) => (
                  <tr key={field}>
                    <td className="text-sub" style={{ width: 220 }}>{field}</td>
                    <td>{renderValue(value)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {r.decision === "approved" ? (
            <p className="text-good" style={{ marginTop: 12, fontWeight: 600 }}>
              已批准,等待执行器提交。如需撤回,请直接告诉执行器会话。
              {!executorRunning && <span className="text-warn"> (执行器未运行)</span>}
            </p>
          ) : (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={() => decide(r.jobId, "approve")} disabled={busyId === r.jobId}>
                确认提交
              </button>
              <button className="btn-ghost" onClick={() => decide(r.jobId, "reject")} disabled={busyId === r.jobId}>
                拒绝
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
