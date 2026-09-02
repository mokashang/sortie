import { getDb } from "@/lib/db";
import { directionLabel } from "@/matcher/directions";

export const dynamic = "force-dynamic";

interface QRow {
  id: number; company: string; title: string; location: string | null;
  apply_url: string; direction: string | null; score: number; tier: number | null;
  reason: string | null; posted_at: string | null;
}

interface DirectionGroup {
  direction: string | null;
  tier: number | null;
  rows: QRow[];
}

export default function QueuePage() {
  const db = getDb();
  // No LIMIT here (unlike the flat /api/queue list): a global row cap applied before grouping
  // would truncate unevenly across directions — a global score-ordered cutoff can starve a
  // lower-scoring-but-large direction while a high-scoring-but-small one keeps all its rows,
  // which breaks both the group ordering (by true matched count) and the "已匹配 N" counts below.
  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, m.direction, m.score, m.tier, m.reason, j.posted_at
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND j.loc_flag IS NULL
       ORDER BY COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC`
    )
    .all() as QRow[];

  const matchedTotal = (
    db
      .prepare(
        `SELECT COUNT(*) n FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE a.status='matched' AND j.loc_flag IS NULL`
      )
      .get() as { n: number }
  ).n;
  const scoredTotal = (db.prepare("SELECT COUNT(*) n FROM matches").get() as { n: number }).n;

  // Group rows by direction, preserving the SQL order within each direction (score DESC,
  // created_at DESC — the query above already sorts that way). Group order: tier ASC (COALESCE
  // to 9), then matched count DESC — same priority the picker itself uses, so the panel order
  // matches "what gets applied to first". NULL direction ("未分类") always sorts last.
  const groupMap = new Map<string | null, DirectionGroup>();
  for (const r of rows) {
    const key = r.direction;
    let group = groupMap.get(key);
    if (!group) {
      group = { direction: r.direction, tier: r.tier, rows: [] };
      groupMap.set(key, group);
    }
    group.rows.push(r);
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    if (a.direction === null && b.direction !== null) return 1;
    if (a.direction !== null && b.direction === null) return -1;
    const tierDiff = (a.tier ?? 9) - (b.tier ?? 9);
    if (tierDiff !== 0) return tierDiff;
    return b.rows.length - a.rows.length;
  });

  return (
    <div>
      <h1>申请队列 <small>(已匹配 {matchedTotal} / 已打分 {scoredTotal})</small></h1>
      <p className="panel-sub">
        按方向分组,组内按 梯队 × 匹配分 × 新鲜度 排序。分数 ≥ 阈值且未归档的职位在此,最值钱的排最前。
      </p>
      {groups.length === 0 ? (
        <p className="text-sub">队列中没有已匹配的职位。</p>
      ) : (
        groups.map((g) => (
          <section className="panel" key={g.direction ?? "__none__"}>
            <div className="panel-title">
              {g.direction ? directionLabel(g.direction) : "未分类"} · 梯队 {g.tier ?? "—"} · 已匹配 {g.rows.length}
            </div>
            <table>
              <thead>
                <tr><th className="num">分</th><th>公司</th><th>标题</th><th>地点</th><th>理由</th><th></th></tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num" style={{ fontWeight: 700 }}>{r.score}</td>
                    <td className="company">{r.company}</td>
                    <td>{r.title}</td>
                    <td>{r.location ?? "—"}</td>
                    <td className="text-sub" style={{ fontSize: 12, maxWidth: 280 }}>{r.reason ?? ""}</td>
                    <td><a href={r.apply_url} target="_blank" rel="noreferrer">申请</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
