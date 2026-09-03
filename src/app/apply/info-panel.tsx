"use client";
import { useCallback, useEffect, useState } from "react";
import { directionLabel } from "@/matcher/directions";

interface Question {
  key: string;
  label: string;
  hint?: string;
  options?: string[];
}
interface InfoRow {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  status: string;
  needsManualReason: string | null;
  questions: Question[];
  askedAt: string;
}

// 待补信息: the executor hit a required question the answer pack can't answer and is waiting on
// the form (status needs_info) — or waited 30 minutes, parked the job and kept the questions.
// Each card is a small form; submitting stores the answers, remembers them into Profile 标准答案
// unless 「仅本次」 is ticked, and lets the executor (or the next run) carry on with this job.
export function InfoPanel() {
  const [rows, setRows] = useState<InfoRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Record<string, { value: string; onlyOnce: boolean }>>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/apply/pending");
      if (!r.ok) return;
      const j = await r.json();
      setRows(j.needsInfo ?? []);
    } catch {
      // keep last known list
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  function draft(jobId: number, key: string) {
    return drafts[jobId]?.[key] ?? { value: "", onlyOnce: false };
  }
  function setDraft(jobId: number, key: string, patch: Partial<{ value: string; onlyOnce: boolean }>) {
    setDrafts((prev) => ({
      ...prev,
      [jobId]: { ...(prev[jobId] ?? {}), [key]: { ...draft(jobId, key), ...patch } },
    }));
  }

  async function submit(row: InfoRow) {
    setBusyId(row.jobId);
    setError("");
    setNotice("");
    try {
      const answers: Record<string, { value: string; remember: boolean }> = {};
      for (const q of row.questions) {
        const d = draft(row.jobId, q.key);
        answers[q.key] = { value: d.value, remember: !d.onlyOnce };
      }
      const r = await fetch("/api/apply/answer-info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: row.jobId, answers }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(`提交失败:${j.error ?? r.status}`);
        return;
      }
      setNotice(
        j.status === "prepared"
          ? `已交给执行器,它会接着填 ${row.company} 的表单。`
          : `已保存并重新入队,下一次投递会带上这些答案继续投 ${row.company}。`
      );
      await refresh();
    } catch (e) {
      setError(`提交失败:${e}`);
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0 && !notice) return null;

  return (
    <section className="panel" style={{ borderColor: "var(--warn)" }}>
      <div className="panel-title">待补信息 ({rows.length})</div>
      <p className="panel-sub">
        执行器填到一半发现这些题答案包里没有,正停在表单上等你。填完点「提交答案」,它会接着投这个岗位;
        默认记进 Profile 标准答案,下次不再问,岗位特有的题勾「仅本次」。
      </p>
      {notice && <p className="text-good">{notice}</p>}
      {error && <p className="text-accent">{error}</p>}
      {rows.map((row) => (
        <div key={row.jobId} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <strong className="company-name">{row.company}</strong> · {row.title}
              <span className="chip" style={{ marginLeft: 8 }}>{row.direction ? directionLabel(row.direction) : "未分类"}</span>
              {row.status === "needs_info" ? (
                <span className="text-warn" style={{ marginLeft: 8, fontWeight: 600 }}>执行器等待中 · {row.askedAt}</span>
              ) : (
                <span className="text-sub" style={{ marginLeft: 8 }}>执行器已超时({row.needsManualReason}),补完后重新入队</span>
              )}
            </div>
            {row.applyUrl && (
              <a href={row.applyUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                看职位
              </a>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {row.questions.map((q) => {
              const d = draft(row.jobId, q.key);
              return (
                <div key={q.key}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {q.label} <span className="text-sub mono" style={{ fontWeight: 400, fontSize: 11 }}>({q.key})</span>
                  </div>
                  {q.hint && <div className="text-sub" style={{ fontSize: 12 }}>{q.hint}</div>}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                    {q.options && q.options.length > 0 ? (
                      <select
                        value={d.value}
                        onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })}
                        style={{ minWidth: 260 }}
                      >
                        <option value="">选择…</option>
                        {q.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={d.value}
                        onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })}
                        placeholder="你的答案"
                        style={{ flex: 1, minWidth: 260 }}
                      />
                    )}
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                      <input
                        type="checkbox"
                        checked={d.onlyOnce}
                        onChange={(e) => setDraft(row.jobId, q.key, { onlyOnce: e.target.checked })}
                      />
                      仅本次
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => submit(row)} disabled={busyId === row.jobId}>
              提交答案,继续投递
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
