import { getDb } from "@/lib/db";
import { ConfirmPanel } from "./confirm-panel";
import { UnparkButton } from "./unpark-button";
import { ExecutorPanel } from "@/app/components/executor-panel";
import { directionLabel } from "@/matcher/directions";

export const dynamic = "force-dynamic";

interface ManualRow {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  needs_manual_reason: string;
  direction: string | null;
}

interface SubmittedRow {
  job_id: number;
  company: string;
  title: string;
  submitted_at: string;
  direction: string | null;
}

export default function ApplyPage() {
  const db = getDb();

  const pendingCount = (
    db.prepare("SELECT COUNT(*) n FROM applications WHERE status='awaiting_confirm'").get() as { n: number }
  ).n;

  const manualRows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, j.apply_url, a.needs_manual_reason, m.direction
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND a.needs_manual_reason IS NOT NULL
       ORDER BY a.job_id DESC
       LIMIT 100`
    )
    .all() as ManualRow[];

  const submittedRows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, a.submitted_at, m.direction
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'submitted' AND a.submitted_at >= date('now')
       ORDER BY a.submitted_at DESC`
    )
    .all() as SubmittedRow[];

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
        点下面的按钮直接从 App 里启动投递执行器(headless claude 会话,用系统专属的浏览器档案自动填表)——不用再手动开
        claude 会话。执行器会话填完表后,申请会出现在下面等你确认。点[确认提交]后执行器才会真正点提交;拒绝会把
        申请退回队列。
      </p>

      <ExecutorPanel
        kinds={[
          { kind: "apply", label: "开始投递", quotaTable: true },
          { kind: "jd_review", label: "补正文(Claude 逐页读)", withLimit: true, defaultLimit: 40, headlessOnly: true, pendingCountUrl: "/api/jd-review/pending-count" },
        ]}
      />

      <div style={{ display: "flex", gap: 24, margin: "16px 0 20px", fontSize: 14 }}>
        <span>
          今日已提交 <strong className="mono">{submittedRows.length}</strong>
          {submittedBreakdown && <span className="text-sub" style={{ marginLeft: 6 }}>({submittedBreakdown})</span>}
        </span>
        <span>待确认 <strong className="mono">{pendingCount}</strong></span>
        <span>需人工 <strong className="mono">{manualRows.length}</strong></span>
      </div>

      <section className="panel">
        <div className="panel-title">待确认</div>
        <ConfirmPanel />
      </section>

      <details style={{ marginTop: 24 }}>
        <summary>需人工清单 ({manualRows.length})</summary>
        {manualRows.length === 0 ? (
          <p className="text-sub" style={{ marginTop: 8 }}>无。</p>
        ) : (
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>方向</th>
                <th>公司</th>
                <th>标题</th>
                <th>原因</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {manualRows.map((r) => (
                <tr key={r.job_id}>
                  <td>
                    <span className="chip">{r.direction ? directionLabel(r.direction) : "未分类"}</span>
                  </td>
                  <td className="company">{r.company}</td>
                  <td>{r.title}</td>
                  <td className="text-sub" style={{ fontSize: 12, maxWidth: 320 }}>{r.needs_manual_reason}</td>
                  <td>
                    {r.apply_url ? (
                      <a href={r.apply_url} target="_blank" rel="noreferrer">
                        申请
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <UnparkButton jobId={r.job_id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <details style={{ marginTop: 16 }}>
        <summary>今日已提交 ({submittedRows.length})</summary>
        {submittedRows.length === 0 ? (
          <p className="text-sub" style={{ marginTop: 8 }}>无。</p>
        ) : (
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>方向</th>
                <th>公司</th>
                <th>标题</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {submittedRows.map((r) => (
                <tr key={r.job_id}>
                  <td>
                    <span className="chip">{r.direction ? directionLabel(r.direction) : "未分类"}</span>
                  </td>
                  <td className="company">{r.company}</td>
                  <td>{r.title}</td>
                  <td className="mono">{r.submitted_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
