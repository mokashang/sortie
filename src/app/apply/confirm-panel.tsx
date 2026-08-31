"use client";
import { useEffect, useState, useCallback } from "react";

interface PendingRow {
  jobId: number;
  company: string;
  title: string;
  direction: string | null;
  score: number | null;
  filledFields: Record<string, string>;
  resumeVersion: string | null;
  decision: string | null;
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

// Confirmation queue: polls /api/apply/pending every 3s so a card disappears on its own once
// the executor (or another browser tab) moves the application past awaiting_confirm — either
// because this user approved+submitted it, or because a decision was made elsewhere.
export function ConfirmPanel() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

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

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  async function decide(jobId: number, decision: "approve" | "reject") {
    let reason: string | undefined;
    if (decision === "reject") {
      reason = window.prompt("拒绝原因(可选)") ?? undefined;
    }
    setBusyId(jobId);
    setError("");
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
      await refresh();
    } catch (e) {
      setError(`操作失败:${e}`);
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <p style={{ color: "#666" }}>暂无待确认的申请。执行器会话完成填表后会出现在这里。</p>;
  }

  return (
    <div>
      {error && <p style={{ color: "#b00" }}>{error}</p>}
      {rows.map((r) => (
        <div key={r.jobId} style={{ background: "#fff", borderRadius: 8, padding: 16, margin: "12px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <strong>{r.company}</strong> · {r.title}
              <span style={{ color: "#666", marginLeft: 8 }}>
                {r.direction ?? "—"} · 分 {r.score ?? "—"}
              </span>
            </div>
            <div style={{ color: "#666", fontSize: 13 }}>简历版本:{r.resumeVersion ?? "—"}</div>
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
                  <td colSpan={2} style={{ color: "#999" }}>
                    (执行器未回报任何字段)
                  </td>
                </tr>
              ) : (
                Object.entries(r.filledFields).map(([field, value]) => (
                  <tr key={field}>
                    <td style={{ width: 220, color: "#555" }}>{field}</td>
                    <td>{renderValue(value)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {r.decision === "approved" ? (
            <p style={{ marginTop: 12, color: "#2a7a2a", fontWeight: 600 }}>
              已批准,等待执行器提交。如需撤回,请直接告诉执行器会话。
            </p>
          ) : (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={() => decide(r.jobId, "approve")} disabled={busyId === r.jobId}>
                确认提交
              </button>
              <button onClick={() => decide(r.jobId, "reject")} disabled={busyId === r.jobId}>
                拒绝
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
