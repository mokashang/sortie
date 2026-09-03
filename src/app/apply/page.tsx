import { getDb } from "@/lib/db";
import { ConfirmPanel } from "./confirm-panel";
import { InfoPanel } from "./info-panel";
import { ManualList, ManualRow } from "./manual-list";
import { ExecutorPanel } from "@/app/components/executor-panel";
import { directionLabel } from "@/matcher/directions";
import { todaySubmitted } from "@/apply/history";
import { referralBoard } from "@/apply/referral";
import { ReferralPanel } from "./referral-panel";

export const dynamic = "force-dynamic";

export default function ApplyPage() {
  const db = getDb();

  const pendingCount = (
    db.prepare("SELECT COUNT(*) n FROM applications WHERE status='awaiting_confirm'").get() as { n: number }
  ).n;

  const manualRows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, j.apply_url, a.needs_manual_reason, m.direction,
              strftime('%m-%d %H:%M', a.updated_at, 'localtime') as updated_at
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND a.needs_manual_reason IS NOT NULL AND a.pending_questions IS NULL
       ORDER BY a.updated_at DESC
       LIMIT 200`
    )
    .all() as ManualRow[];

  // Parked rows that still carry pending_questions are shown on the 待补信息 panel instead (they
  // are answerable in-App), so they're excluded from the needs-manual list above.
  // Local calendar day (resets at local midnight) — see todaySubmitted.
  const submittedRows = todaySubmitted(db);

  // 内推进行中 counts for the strip (the board itself is the client-side ReferralPanel).
  const cards = referralBoard(db);
  const referralJobs = cards.flatMap((c) => c.jobs);
  const referralCounts = {
    draft: cards.filter((c) => c.outreach?.status === "draft").length,
    waiting: cards.filter((c) => c.outreach && (c.outreach.status === "sent" || c.outreach.status === "pending_send")).length,
    noContact: cards.filter((c) => !c.outreach && c.jobs.some((j) => j.noContactReason)).length,
    ready: cards.filter((c) => c.jobs.some((j) => j.status === "referral_ready")).length,
  };

  // "今日已提交 7(swe_backend 4 · quant 3)" — per-direction breakdown, counts desc, NULL last.
  const submittedByDirection = new Map<string | null, number>();
  for (const r of submittedRows) {
    submittedByDirection.set(r.direction, (submittedByDirection.get(r.direction) ?? 0) + 1);
  }
  const submittedBreakdown = [...submittedByDirection.entries()]
    .sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return b[1] - a[1];
    })
    .map(([direction, count]) => `${direction ? directionLabel(direction) : "未分类"} ${count}`)
    .join(" · ");

  return (
    <div>
      <h1>投递</h1>
      <p className="panel-sub">
        在下面选好每个方向「找内推」和「海投」的份数、点「开始投递」,值守会话(你自己的 Chrome)就会接手。
        海投的申请填完出现在「待确认」等你点[确认提交],执行器才会真正点提交;拒绝会把申请退回队列。
        找内推的岗位出现在「内推进行中」:值守会话找到人后起草首条消息等你批准,之后的往来你自己处理;
        拿到内推点「有内推了」填入,或随时「直接投」。已提交及之后的追踪在「历史」页。
      </p>

      <ExecutorPanel kinds={[{ kind: "apply", label: "开始投递", quotaTable: true }]} />

      <div style={{ display: "flex", gap: 24, margin: "16px 0 20px", fontSize: 14 }}>
        <span>
          今日已提交 <strong className="mono">{submittedRows.length}</strong>
          {submittedBreakdown && <span className="text-sub" style={{ marginLeft: 6 }}>({submittedBreakdown})</span>}
        </span>
        <span>待确认 <strong className="mono">{pendingCount}</strong></span>
        <span>
          内推进行中 <strong className="mono">{referralJobs.length}</strong>
          {referralJobs.length > 0 && (
            <span className="text-sub" style={{ marginLeft: 6 }}>
              (等草稿 {referralCounts.draft} · 等回复 {referralCounts.waiting} · 找不到人 {referralCounts.noContact} · 待投 {referralCounts.ready})
            </span>
          )}
        </span>
        <span>需人工 <strong className="mono">{manualRows.length}</strong></span>
      </div>

      <InfoPanel />

      <section className="panel">
        <div className="panel-title">待确认</div>
        <ConfirmPanel />
      </section>

      <section className="panel">
        <div className="panel-title">内推进行中</div>
        <ReferralPanel />
      </section>

      <details style={{ marginTop: 24 }}>
        <summary>需人工清单 ({manualRows.length})</summary>
        <ManualList rows={manualRows} />
      </details>

      <details style={{ marginTop: 16 }}>
        <summary>今日已提交 ({submittedRows.length}) · 本地 0 点重置 · 完整记录见「历史」页</summary>
        {submittedRows.length === 0 ? (
          <p className="text-sub" style={{ marginTop: 8 }}>无。</p>
        ) : (
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>方向</th>
                <th>方式</th>
                <th>公司</th>
                <th>标题</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {submittedRows.map((r) => (
                <tr key={r.jobId}>
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
                  <td>{r.title}</td>
                  <td className="mono">{r.submittedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
