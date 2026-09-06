import { DB, logEvent } from "@/lib/db";
import { Family } from "@/scanner/board-key";

// boards 注册表:凡是被轮询的东西都是一行(公司板块、GitHub 清单、LinkedIn 游客接口、字节门户、Amazon、
// Chrome 通道的三个站点)。产出不存计数器,实时从 jobs.board_key 聚合(spec 2026-09-06 §1)。
export type Tier = "core" | "longtail" | "dormant" | "muted";
export type Origin = "seed" | "url" | "directory" | "builtin" | "manual";
export const TIERS: Tier[] = ["core", "longtail", "dormant", "muted"];
export const CADENCE_MS: Record<Exclude<Tier, "muted">, number> = { core: 3600_000, longtail: 24 * 3600_000, dormant: 7 * 24 * 3600_000 };
export const MAX_404_STREAK = 5;

export interface BoardRow {
  id: number; key: string; family: Family; ident: string; company: string | null; origin: Origin; tier: Tier;
  tier_reason: string | null; tier_locked: number; directions: string | null; meta: string | null;
  next_due_at: string | null; last_polled_at: string | null; last_ok_at: string | null; last_error: string | null;
  fail_count: number; created_at: string; updated_at: string;
}
export interface BoardSpec { key: string; company?: string | null; origin: Origin; tier?: Tier; directions?: string[]; meta?: Record<string, unknown>; }
export interface SeedEntry { key: string; company?: string; directions?: string[]; builtin?: boolean; meta?: Record<string, unknown>; }

// sqlite datetime('now') 的格式(UTC,秒精度),所有 next_due_at / last_* 都用它,方便直接比较。
export const iso = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

export function splitKey(key: string): { family: Family; ident: string } {
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1) throw new Error(`bad board key '${key}'`);
  return { family: key.slice(0, i) as Family, ident: key.slice(i + 1) };
}

// 插入或补全。已存在的行:公司名 / 方向 / meta 只在原来为空时补;种子(seed/builtin)可以把 origin 拉到
// 种子值并升 core,除非用户锁定过 tier。
export function upsertBoards(db: DB, specs: BoardSpec[]): { inserted: number; touched: number } {
  const stmt = db.prepare(
    `INSERT INTO boards (key, family, ident, company, origin, tier, tier_reason, directions, meta)
     VALUES (@key, @family, @ident, @company, @origin, @tier, @tier_reason, @directions, @meta)
     ON CONFLICT(key) DO UPDATE SET
       company     = COALESCE(boards.company, excluded.company),
       directions  = COALESCE(boards.directions, excluded.directions),
       meta        = COALESCE(boards.meta, excluded.meta),
       origin      = CASE WHEN excluded.origin IN ('seed','builtin') THEN excluded.origin ELSE boards.origin END,
       tier_reason = CASE WHEN boards.tier_locked = 0 AND excluded.origin IN ('seed','builtin') AND boards.tier <> 'core' THEN 'seed' ELSE boards.tier_reason END,
       tier        = CASE WHEN boards.tier_locked = 1 THEN boards.tier
                          WHEN excluded.origin IN ('seed','builtin') THEN 'core'
                          ELSE boards.tier END,
       updated_at  = datetime('now')`
  );
  const exists = db.prepare("SELECT 1 FROM boards WHERE key = ?");
  let inserted = 0, touched = 0;
  db.transaction(() => {
    for (const s of specs) {
      const { family, ident } = splitKey(s.key);
      const had = !!exists.get(s.key);
      const seedy = s.origin === "seed" || s.origin === "builtin";
      stmt.run({
        key: s.key, family, ident, company: s.company ?? null, origin: s.origin,
        tier: s.tier ?? (seedy ? "core" : "longtail"), tier_reason: seedy ? "seed" : s.origin,
        directions: s.directions ? JSON.stringify(s.directions) : null, meta: s.meta ? JSON.stringify(s.meta) : null,
      });
      if (had) touched++; else inserted++;
    }
  })();
  return { inserted, touched };
}

export function syncBoardsSeed(db: DB, seed: SeedEntry[]): void {
  upsertBoards(db, seed.map((e) => ({ key: e.key, company: e.company ?? null, origin: e.builtin ? "builtin" : "seed", directions: e.directions, meta: e.meta })));
}

// 每个已入库岗位的 board_key 都是一个可轮询板块的证据:没见过的建成 longtail。
export function discoverBoardsFromJobs(db: DB): number {
  const rows = db.prepare("SELECT board_key AS key, MIN(company) AS company FROM jobs WHERE board_key IS NOT NULL GROUP BY board_key").all() as { key: string; company: string }[];
  return upsertBoards(db, rows.map((r) => ({ key: r.key, company: r.company, origin: "url" as const }))).inserted;
}

export function getBoard(db: DB, key: string): BoardRow | undefined {
  return db.prepare("SELECT * FROM boards WHERE key = ?").get(key) as BoardRow | undefined;
}

export interface DueOpts { now: Date; limit: number; families?: Family[]; tiers?: Tier[]; keys?: string[]; localHour: number; }
// 到期板块:静音和 chrome 家族永不入选;LinkedIn 只在本地 08:00–22:00;顺序 core → longtail → dormant,
// 同层清单优先,再按到期时间早者先。
export function dueBoards(db: DB, o: DueOpts): BoardRow[] {
  const conds = ["tier <> 'muted'", "family <> 'chrome'", "(next_due_at IS NULL OR next_due_at <= ?)"];
  const params: unknown[] = [iso(o.now)];
  const inList = (col: string, vals?: string[]) => { if (vals?.length) { conds.push(`${col} IN (${vals.map(() => "?").join(",")})`); params.push(...vals); } };
  inList("family", o.families); inList("tier", o.tiers); inList("key", o.keys);
  if (o.localHour < 8 || o.localHour >= 22) conds.push("family <> 'linkedin'");
  params.push(o.limit);
  return db.prepare(
    `SELECT * FROM boards WHERE ${conds.join(" AND ")}
     ORDER BY CASE tier WHEN 'core' THEN 0 WHEN 'longtail' THEN 1 ELSE 2 END,
              CASE family WHEN 'github_list' THEN 0 ELSE 1 END,
              COALESCE(next_due_at, '') ASC, id ASC
     LIMIT ?`
  ).all(...params) as BoardRow[];
}

export function nextDueAfter(tier: Tier, failCount: number, now: Date, rand: () => number = Math.random): string | null {
  if (tier === "muted") return null;
  const jitter = 0.9 + rand() * 0.2;                       // ±10%,让几百个核心板块别挤在同一分钟
  const backoff = failCount > 0 ? 2 ** Math.min(failCount, 3) : 1;
  return iso(new Date(now.getTime() + CADENCE_MS[tier] * jitter * backoff));
}

export interface PollOutcome { ok: boolean; error?: string; httpStatus?: number | null; now: Date; rand?: () => number; }
export function markBoardResult(db: DB, key: string, o: PollOutcome): void {
  const b = getBoard(db, key);
  if (!b) return;
  const now = iso(o.now);
  if (o.ok) {
    db.prepare("UPDATE boards SET fail_count=0, last_polled_at=?, last_ok_at=?, last_error=NULL, next_due_at=?, updated_at=datetime('now') WHERE key=?")
      .run(now, now, nextDueAfter(b.tier, 0, o.now, o.rand), key);
    return;
  }
  const failCount = b.fail_count + 1;
  const is404 = o.httpStatus === 404 || /HTTP 404/.test(o.error ?? "");
  const streak404 = is404 && (b.fail_count === 0 || /HTTP 404/.test(b.last_error ?? ""));
  const mute = streak404 && failCount >= MAX_404_STREAK && b.tier_locked === 0 && b.tier !== "muted";
  // 429 = 对方限流:今天别再问了。其余失败按 2^n 退避(封顶 8 倍)。
  const nextDue = mute ? null : o.httpStatus === 429 ? iso(new Date(o.now.getTime() + 24 * 3600_000)) : nextDueAfter(b.tier, failCount, o.now, o.rand);
  db.prepare("UPDATE boards SET fail_count=?, last_polled_at=?, last_error=?, next_due_at=?, tier=?, tier_reason=?, updated_at=datetime('now') WHERE key=?")
    .run(failCount, now, (o.error ?? "error").slice(0, 300), nextDue, mute ? "muted" : b.tier, mute ? `404 x${failCount}` : b.tier_reason, key);
  if (mute) logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key, from: b.tier, to: "muted", reason: `404 x${failCount}` } });
}

export function mergeBoardMeta(db: DB, key: string, patch: Record<string, unknown>): void {
  const b = getBoard(db, key);
  if (!b) return;
  let cur: Record<string, unknown> = {};
  try { cur = b.meta ? (JSON.parse(b.meta) as Record<string, unknown>) : {}; } catch { cur = {}; }
  db.prepare("UPDATE boards SET meta=?, updated_at=datetime('now') WHERE key=?").run(JSON.stringify({ ...cur, ...patch }), key);
}

// 用户在来源页手动改层级:锁定,自动升降不再碰它;非静音时立刻到期。
export function setBoardTier(db: DB, key: string, tier: Tier): void {
  const b = getBoard(db, key);
  if (!b) throw new Error(`unknown board ${key}`);
  db.prepare("UPDATE boards SET tier=?, tier_reason='user', tier_locked=1, next_due_at=CASE WHEN ?='muted' THEN next_due_at ELSE NULL END, updated_at=datetime('now') WHERE key=?").run(tier, tier, key);
  logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key, from: b.tier, to: tier, reason: "user" } });
}

export interface BoardStats { ge75_90d: number; ge60_90d: number; jobs30: number; ge75_30: number; }
export function boardStats(db: DB): Map<string, BoardStats> {
  const rows = db.prepare(
    `SELECT j.board_key AS key,
       SUM(CASE WHEN m.score >= 75 AND j.created_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS ge75_90d,
       SUM(CASE WHEN m.score >= 60 AND j.created_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS ge60_90d,
       SUM(CASE WHEN j.created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS jobs30,
       SUM(CASE WHEN m.score >= 75 AND j.created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS ge75_30
     FROM jobs j LEFT JOIN matches m ON m.job_id = j.id
     WHERE j.board_key IS NOT NULL GROUP BY j.board_key`
  ).all() as (BoardStats & { key: string })[];
  return new Map(rows.map((r) => [r.key, { ge75_90d: r.ge75_90d, ge60_90d: r.ge60_90d, jobs30: r.jobs30, ge75_30: r.ge75_30 }]));
}
