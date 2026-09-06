import { DB, logEvent } from "@/lib/db";
import { BoardRow, Origin, Tier, boardStats } from "@/scanner/boards";

export interface RetierInput { origin: Origin; tier: Tier; tier_locked: number; ge75_90d: number; ge60_90d: number; polledDays: number; }

// spec 2026-09-06 §1.4 的分级规则,纯函数。返回 null = 不变。
//   core     每小时:种子;或近 90 天 ≥1 个 ≥75 分岗;或 ≥3 个 ≥60 分岗
//   longtail 每天:  默认层;core 连续 90 天无高分回到这里;dormant 见到 ≥60 也回到这里
//   dormant  每周:  longtail 连续 30 天有轮询且零 ≥60
//   muted    不轮询:只由用户(或 404×5)设置,这里不碰
export function computeTier(i: RetierInput): { tier: Tier; reason: string } | null {
  if (i.tier_locked) return null;
  if (i.tier === "muted") return null;
  if (i.origin === "seed" || i.origin === "builtin") return i.tier === "core" ? null : { tier: "core", reason: "seed" };
  if (i.ge75_90d >= 1 || i.ge60_90d >= 3) return i.tier === "core" ? null : { tier: "core", reason: `>=75 x${i.ge75_90d}, >=60 x${i.ge60_90d} in 90d` };
  if (i.tier === "core") return { tier: "longtail", reason: "no >=75 in 90d" };
  if (i.tier === "dormant") return i.ge60_90d >= 1 ? { tier: "longtail", reason: ">=60 seen" } : null;
  if (i.tier === "longtail" && i.ge60_90d === 0 && i.polledDays >= 30) return { tier: "dormant", reason: "30d polled, no >=60" };
  return null;
}

export function retierAll(db: DB, now: Date = new Date()): { changed: number } {
  const stats = boardStats(db);
  const boards = db.prepare("SELECT * FROM boards WHERE family <> 'chrome'").all() as BoardRow[];
  const upd = db.prepare("UPDATE boards SET tier=?, tier_reason=?, next_due_at=CASE WHEN ?='core' THEN NULL ELSE next_due_at END, updated_at=datetime('now') WHERE id=?");
  let changed = 0;
  db.transaction(() => {
    for (const b of boards) {
      const s = stats.get(b.key) ?? { ge75_90d: 0, ge60_90d: 0, jobs30: 0, ge75_30: 0 };
      const polledDays = b.last_ok_at ? (now.getTime() - new Date(b.created_at.replace(" ", "T") + "Z").getTime()) / 86_400_000 : 0;
      const r = computeTier({ origin: b.origin, tier: b.tier, tier_locked: b.tier_locked, ge75_90d: s.ge75_90d, ge60_90d: s.ge60_90d, polledDays });
      if (!r) continue;
      upd.run(r.tier, r.reason, r.tier, b.id);
      logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key: b.key, from: b.tier, to: r.tier, reason: r.reason } });
      changed++;
    }
  })();
  return { changed };
}

// 匹配器刚写入的 ≥75 分岗:所属板块立即升 core 并置为到期(spec §1.4 "不等第二天")。
export function promoteRecentHighScores(db: DB, sinceIso: string): number {
  const rows = db.prepare(
    `SELECT DISTINCT b.id, b.key, b.tier FROM matches m JOIN jobs j ON j.id = m.job_id JOIN boards b ON b.key = j.board_key
     WHERE m.score >= 75 AND m.created_at >= ? AND b.tier IN ('longtail','dormant') AND b.tier_locked = 0`
  ).all(sinceIso) as { id: number; key: string; tier: Tier }[];
  const upd = db.prepare("UPDATE boards SET tier='core', tier_reason='high-score job', next_due_at=NULL, updated_at=datetime('now') WHERE id=?");
  for (const r of rows) {
    upd.run(r.id);
    logEvent(db, "board_retier", { entity: "board", entityId: r.id, payload: { key: r.key, from: r.tier, to: "core", reason: "high-score job" } });
  }
  return rows.length;
}
