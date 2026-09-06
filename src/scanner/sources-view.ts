import { DB } from "@/lib/db";
import { BoardRow, Tier } from "@/scanner/boards";
import { Family } from "@/scanner/board-key";

// /sources 来源页与 /api/sources 的查询函数(纯 DB,可单测)。

export interface FamilySummary { family: Family; core: number; longtail: number; dormant: number; muted: number; jobs30: number; ge75_30: number; errors24h: number; }
export function sourcesSummary(db: DB): { families: FamilySummary[]; lastTick: { at: string; payload: unknown } | null } {
  const families = db.prepare(
    `SELECT b.family,
       SUM(b.tier='core') AS core, SUM(b.tier='longtail') AS longtail, SUM(b.tier='dormant') AS dormant, SUM(b.tier='muted') AS muted,
       SUM(b.last_error IS NOT NULL AND b.last_polled_at >= datetime('now','-1 day')) AS errors24h,
       (SELECT COUNT(*) FROM jobs j WHERE j.board_key IN (SELECT key FROM boards x WHERE x.family=b.family) AND j.created_at >= datetime('now','-30 days')) AS jobs30,
       (SELECT COUNT(*) FROM jobs j JOIN matches m ON m.job_id=j.id WHERE j.board_key IN (SELECT key FROM boards x WHERE x.family=b.family) AND j.created_at >= datetime('now','-30 days') AND m.score>=75) AS ge75_30
     FROM boards b GROUP BY b.family ORDER BY ge75_30 DESC, jobs30 DESC, b.family ASC`
  ).all() as FamilySummary[];
  const t = db.prepare("SELECT at, payload FROM events WHERE kind='scan_tick' ORDER BY id DESC LIMIT 1").get() as { at: string; payload: string } | undefined;
  return { families, lastTick: t ? { at: t.at, payload: JSON.parse(t.payload) } : null };
}

export interface PagedBoardsOpts { family?: string; tier?: Tier; q?: string; page: number; pageSize: number; }
export type BoardView = BoardRow & { jobs30: number; ge75_30: number };
export function pagedBoards(db: DB, o: PagedBoardsOpts): { rows: BoardView[]; total: number; pages: number } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (o.family) { conds.push("b.family = ?"); params.push(o.family); }
  if (o.tier) { conds.push("b.tier = ?"); params.push(o.tier); }
  if (o.q) { conds.push("(b.company LIKE ? OR b.key LIKE ?)"); params.push(`%${o.q}%`, `%${o.q}%`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) n FROM boards b ${where}`).get(...params) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / o.pageSize));
  const page = Math.min(Math.max(1, o.page), pages);
  const rows = db.prepare(
    `SELECT b.*,
       (SELECT COUNT(*) FROM jobs j WHERE j.board_key=b.key AND j.created_at >= datetime('now','-30 days')) AS jobs30,
       (SELECT COUNT(*) FROM jobs j JOIN matches m ON m.job_id=j.id WHERE j.board_key=b.key AND j.created_at >= datetime('now','-30 days') AND m.score>=75) AS ge75_30
     FROM boards b ${where}
     ORDER BY CASE b.tier WHEN 'core' THEN 0 WHEN 'longtail' THEN 1 WHEN 'dormant' THEN 2 ELSE 3 END, ge75_30 DESC, jobs30 DESC, b.company COLLATE NOCASE ASC, b.key ASC
     LIMIT ? OFFSET ?`
  ).all(...params, o.pageSize, (page - 1) * o.pageSize) as BoardView[];
  return { rows, total, pages };
}

export interface BoardEvent { at: string; key: string; from: string; to: string; reason: string; }
export function recentBoardEvents(db: DB, limit = 50): BoardEvent[] {
  const rows = db.prepare("SELECT at, payload FROM events WHERE kind='board_retier' ORDER BY id DESC LIMIT ?").all(limit) as { at: string; payload: string }[];
  return rows.map((r) => { const p = JSON.parse(r.payload) as { key: string; from: string; to: string; reason: string }; return { at: r.at, ...p }; });
}
