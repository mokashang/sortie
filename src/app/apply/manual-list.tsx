"use client";
import { useState } from "react";
import { directionLabel } from "@/matcher/directions";
import { UnparkButton } from "./unpark-button";

export interface ManualRow {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  needs_manual_reason: string;
  direction: string | null;
  updated_at: string; // local "MM-DD HH:MM"
}

// /apply's 需人工清单: rows the executor (or the user's reject) parked. Besides 重试 (unpark) and
// 申请 (open the posting), each row can be removed — singly or as a checked batch — which
// archives it (reversible from /queue's undo strip / unarchive API) so problems don't pile up
// here forever.
export function ManualList({ rows }: { rows: ManualRow[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(jobId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.job_id)));
  }

  async function remove(jobIds: number[]) {
    if (jobIds.length === 0) return;
    if (!window.confirm(`移除 ${jobIds.length} 条?(归档,可在队列页撤销)`)) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/apply/archive-manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(`移除失败:${j.error ?? r.status}`);
        return;
      }
      location.reload();
    } catch (e) {
      setError(`移除失败:${e}`);
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sub" style={{ marginTop: 8 }}>无。</p>;
  }

  return (
    <div style={{ marginTop: 8 }}>
      {error && <p className="text-accent">{error}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={busy} />
          全选
        </label>
        <button
          className="btn-ghost"
          onClick={() => remove([...selected])}
          disabled={busy || selected.size === 0}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          移除所选({selected.size})
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>方向</th>
            <th>公司</th>
            <th>标题</th>
            <th>原因</th>
            <th>时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.job_id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(r.job_id)}
                  onChange={() => toggle(r.job_id)}
                  disabled={busy}
                />
              </td>
              <td>
                <span className="chip">{r.direction ? directionLabel(r.direction) : "未分类"}</span>
              </td>
              <td className="company">{r.company}</td>
              <td>{r.title}</td>
              <td className="text-sub" style={{ fontSize: 12, maxWidth: 320 }}>{r.needs_manual_reason}</td>
              <td className="mono text-sub" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{r.updated_at}</td>
              <td>
                <div className="row-actions">
                  {r.apply_url && (
                    <a href={r.apply_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      申请
                    </a>
                  )}
                  <UnparkButton jobId={r.job_id} />
                  <button
                    className="btn-ghost"
                    onClick={() => remove([r.job_id])}
                    disabled={busy}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                  >
                    移除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
