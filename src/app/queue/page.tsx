import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface QRow {
  id: number; company: string; title: string; location: string | null;
  apply_url: string; direction: string | null; score: number; tier: number | null;
  reason: string | null; posted_at: string | null;
}

export default function QueuePage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, m.direction, m.score, m.tier, m.reason, j.posted_at
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched'
       ORDER BY COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC
       LIMIT 1000`
    )
    .all() as QRow[];

  const matchedTotal = (db.prepare("SELECT COUNT(*) n FROM applications WHERE status='matched'").get() as { n: number }).n;
  const scoredTotal = (db.prepare("SELECT COUNT(*) n FROM matches").get() as { n: number }).n;

  return (
    <div>
      <h1>申请队列 <small>(已匹配 {matchedTotal} / 已打分 {scoredTotal})</small></h1>
      <p style={{ color: "#666", fontSize: 13, margin: "8px 0 16px" }}>
        按 梯队 × 匹配分 × 新鲜度 排序。分数 ≥ 阈值且未归档的职位在此,最值钱的排最前。
      </p>
      <table>
        <thead>
          <tr><th>分</th><th>梯队</th><th>方向</th><th>公司</th><th>标题</th><th>地点</th><th>理由</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontWeight: 700 }}>{r.score}</td>
              <td>{r.tier ?? "—"}</td>
              <td>{r.direction ?? "—"}</td>
              <td>{r.company}</td>
              <td>{r.title}</td>
              <td>{r.location ?? "—"}</td>
              <td style={{ fontSize: 12, color: "#555", maxWidth: 280 }}>{r.reason ?? ""}</td>
              <td><a href={r.apply_url} target="_blank" rel="noreferrer">申请</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
