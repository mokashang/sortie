"use client";
import { useMemo, useState } from "react";
import { directionLabel } from "@/matcher/directions";
import { POST_SUBMIT_STAGES, STAGE_LABELS, HistoryRow, PostSubmitStage } from "@/apply/stages";
import { HistorySankey } from "./history-sankey";
import { ModeFilter, ModeFilterValue } from "@/app/components/mode-filter";

const ALL = "__all__";

function stageClass(stage: PostSubmitStage): string {
  switch (stage) {
    case "offer":
    case "offer_accepted":
      return "text-warn";
    case "oa":
    case "interview":
      return "text-good";
    case "offer_declined":
    case "rejected":
    case "stale":
      return "text-sub";
    default:
      return "";
  }
}

export function HistoryBoard({ rows }: { rows: HistoryRow[] }) {
  const [direction, setDirection] = useState<string>(ALL);
  const [modeFilter, setModeFilter] = useState<ModeFilterValue>("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // Direction tabs in descending count order, "未分类" (null direction) last, "全部" first.
  const tabs = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const r of rows) counts.set(r.direction, (counts.get(r.direction) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return b[1] - a[1];
    });
  }, [rows]);

  const visible = (direction === ALL ? rows : rows.filter((r) => (r.direction ?? "") === direction)).filter(
    (r) => modeFilter === "all" || r.applyMode === modeFilter
  );
  const modeCounts = {
    all: rows.length,
    referral: rows.filter((r) => r.applyMode === "referral").length,
    direct: rows.filter((r) => r.applyMode === "direct").length,
  };

  const stageCounts = useMemo(() => {
    const m = new Map<PostSubmitStage, number>();
    for (const r of visible) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [visible]);

  // Group by local submission day, preserving the newest-first order rows already come in.
  const days = useMemo(() => {
    const groups: { day: string; rows: HistoryRow[] }[] = [];
    for (const r of visible) {
      const last = groups[groups.length - 1];
      if (last && last.day === r.submittedDay) last.rows.push(r);
      else groups.push({ day: r.submittedDay, rows: [r] });
    }
    return groups;
  }, [visible]);

  async function changeStage(jobId: number, stage: string) {
    const note = window.prompt("备注(可选,例如:OA 截止 9/15 / 面试官 xxx)") ?? undefined;
    setBusyId(jobId);
    setError("");
    try {
      const r = await fetch("/api/apply/stage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, stage, note }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(`更新失败:${j.error ?? r.status}`);
        return;
      }
      location.reload();
    } catch (e) {
      setError(`更新失败:${e}`);
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sub">还没有投出去的申请。去「投递」页确认提交后会出现在这里。</p>;
  }

  return (
    <div>
      <div className="tabbar">
        <button className={`tab${direction === ALL ? " active" : ""}`} onClick={() => setDirection(ALL)}>
          全部 <span className="tab-count">{rows.length}</span>
        </button>
        {tabs.map(([dir, n]) => {
          const key = dir ?? "";
          return (
            <button key={key} className={`tab${direction === key ? " active" : ""}`} onClick={() => setDirection(key)}>
              {dir ? directionLabel(dir) : "未分类"} <span className="tab-count">{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ margin: "10px 0 0" }}>
        <ModeFilter value={modeFilter} onChange={setModeFilter} labels={{ referral: "内推", direct: "海投" }} counts={modeCounts} />
      </div>

      <div style={{ display: "flex", gap: 18, margin: "12px 0 16px", fontSize: 13, flexWrap: "wrap" }}>
        {POST_SUBMIT_STAGES.map((s) => (
          <span key={s} className={stageClass(s)}>
            {STAGE_LABELS[s]} <strong className="mono">{stageCounts.get(s) ?? 0}</strong>
          </span>
        ))}
      </div>

      <HistorySankey rows={visible} />

      {error && <p className="text-accent">{error}</p>}

      {days.map((g) => (
        <section className="panel" key={g.day}>
          <div className="panel-title">
            {g.day} <span className="text-sub" style={{ fontWeight: 400, marginLeft: 8 }}>{g.rows.length} 份</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>方向</th>
                <th>方式</th>
                <th>公司</th>
                <th>标题</th>
                <th>简历</th>
                <th>状态</th>
                <th>最后更新</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.jobId}>
                  <td className="mono text-sub" style={{ whiteSpace: "nowrap" }}>{r.submittedAt.slice(11)}</td>
                  <td>
                    <span className="chip">{r.direction ? directionLabel(r.direction) : "未分类"}</span>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {r.applyMode === "referral" ? (
                      <span className="text-good">内推{r.referralPersonName ? ` · ${r.referralPersonName}` : ""}</span>
                    ) : (
                      <span className="text-sub">海投</span>
                    )}
                  </td>
                  <td className="company">{r.company}</td>
                  <td>
                    {r.applyUrl ? (
                      <a href={r.applyUrl} target="_blank" rel="noreferrer">
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}
                  </td>
                  <td className="text-sub" style={{ fontSize: 12 }}>{r.resumeVersion ?? "—"}</td>
                  <td>
                    <select
                      value={r.status}
                      disabled={busyId === r.jobId}
                      onChange={(e) => changeStage(r.jobId, e.target.value)}
                      className={stageClass(r.status)}
                      style={{ fontWeight: 600 }}
                    >
                      {POST_SUBMIT_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="mono text-sub" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{r.updatedAt}</td>
                  <td className="text-sub" style={{ fontSize: 12, maxWidth: 260 }}>{r.lastNote ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
