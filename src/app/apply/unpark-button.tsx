"use client";
import { useState } from "react";

// 需人工清单's per-row retry: clears needs_manual_reason so the job re-enters
// takeNextApplication's pool (e.g. after the user generated the missing-direction resume).
export function UnparkButton({ jobId }: { jobId: number }) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      const r = await fetch("/api/apply/unpark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (r.ok) {
        location.reload();
        return;
      }
      const j = await r.json().catch(() => ({}));
      alert(`重试失败:${j.error ?? r.status}`);
    } catch (e) {
      alert(`重试失败:${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={retry} disabled={busy} style={{ fontSize: 12 }}>
      重试
    </button>
  );
}
