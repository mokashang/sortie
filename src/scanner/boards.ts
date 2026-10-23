import { DB, logEvent } from "@/lib/db";
import { Family } from "@/scanner/board-key";

// boards 注册表:凡是被轮询的东西都是一行(公司板块、GitHub 清单、LinkedIn 游客接口、字节门户、Amazon、
// Chrome 通道的三个站点)。产出不存计数器,实时从 jobs.board_key 聚合(spec 2026-09-06 §1)。
export type Tier = "core" | "longtail" | "dormant" | "muted";
export type Origin = "seed" | "url" | "directory" | "builtin" | "manual";
export const TIERS: Tier[] = ["core", "longtail", "dormant", "muted"];
export const CADENCE_MS: Record<Exclude<Tier, "muted">, number> = { core: 3600_000, longtail: 24 * 3600_000, dormant: 7 * 24 * 3600_000 };
export const MAX_404_STREAK = 5;
// 同一个非 404 的 HTTP 错误状态连续 N 次、而且跨了至少 M 天还没好过一次:租户 / 站点坏了(Workday 的 422 =
// 站点名不对、403 = 受限站点、一直 500 的租户),不是对方一时故障 → 静音(可在来源页改回,记 board_retier)。
// 只数对方明确给的错误状态:429(我们问得太勤)、网络错误、超时、维护页(200 + 网页)都不算,也不打断计数。
// Workday 每周五晚的维护一小时能让几百个板块同时 500 / 回网页(2026-10-17 一次 491 个),所以要「跨天」。
export const PERSISTENT_FAIL_STREAK = 5;
export const PERSISTENT_FAIL_DAYS = 7;
interface FailStreak { status: number; n: number; since: string; }
// 有些家族问一次很贵或对方敏感,同一层级下把周期拉长:Workday 一次要几十上百个请求、iCIMS 是网页、LinkedIn 要保守。
export const FAMILY_CADENCE_MULTIPLIER: Partial<Record<Family, number>> = { workday: 3, icims: 3, linkedin: 2 };

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

// 能从岗位链接里长出来的只有公司自己的 ATS 板块。LinkedIn 游客接口、Amazon、字节门户、Chrome 站点、
// GitHub 清单都是种子 / 内置的单行,只由种子(和 ingest)建。
export const URL_DISCOVERABLE: ReadonlySet<Family> = new Set<Family>(["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "oracle", "icims", "workable"]);
// 新发现的板块首轮轮询在这几个小时内错开(同 importDirectory):一个清单一次冒出几十家,也不会挤进同一跳、压垮打分器。
export const DISCOVERY_SPREAD_HOURS = 6;
export interface DiscoverOpts { now?: Date; rand?: () => number; spreadHours?: number; }

// 岗位链接 → 板块(origin=url,longtail,工程标题门照常生效)。只建没见过的 key:已有的行(种子、静音、
// 用户锁定的)一个字段都不碰。返回新建了几个。
export function registerUrlBoards(db: DB, found: Map<string, string | null>, opts: DiscoverOpts = {}): number {
  const exists = db.prepare("SELECT 1 FROM boards WHERE key = ?");
  const fresh: BoardSpec[] = [];
  for (const [key, company] of found) {
    const i = key.indexOf(":");
    if (i <= 0 || !URL_DISCOVERABLE.has(key.slice(0, i) as Family) || exists.get(key)) continue;
    fresh.push({ key, company, origin: "url" });
  }
  if (!fresh.length) return 0;
  const now = (opts.now ?? new Date()).getTime();
  const rand = opts.rand ?? Math.random;
  const spread = (opts.spreadHours ?? DISCOVERY_SPREAD_HOURS) * 3600_000;
  const upd = db.prepare("UPDATE boards SET next_due_at = ? WHERE key = ?");
  db.transaction(() => {
    upsertBoards(db, fresh);
    for (const s of fresh) upd.run(iso(new Date(now + rand() * spread)), s.key);
  })();
  return fresh.length;
}

// 补登:jobs.board_key 里出现过、boards 里还没有的 key。只走 idx_jobs_board_key(生产库 19 万行 ~10 ms),
// 公司名逐个按索引取一行;不要改回对 jobs 全表 GROUP BY(~300 ms,还会把 jd_text 溢出页读一遍)。
// 平时由 upsertJobs 随到随登,这里是迁移和每个进程第一跳的兜底。
export function discoverBoardsFromJobs(db: DB, opts: DiscoverOpts = {}): number {
  const orphans = db.prepare(
    `SELECT k.board_key AS key FROM (SELECT DISTINCT board_key FROM jobs WHERE board_key IS NOT NULL) k
     WHERE NOT EXISTS (SELECT 1 FROM boards b WHERE b.key = k.board_key)`
  ).all() as { key: string }[];
  if (!orphans.length) return 0;
  const company = db.prepare("SELECT company FROM jobs WHERE board_key = ? LIMIT 1");
  const found = new Map(orphans.map((o) => [o.key, (company.get(o.key) as { company: string | null } | undefined)?.company ?? null]));
  return registerUrlBoards(db, found, opts);
}

export function getBoard(db: DB, key: string): BoardRow | undefined {
  return db.prepare("SELECT * FROM boards WHERE key = ?").get(key) as BoardRow | undefined;
}

// 每个 family 一跳最多挑这么多。一跳 90 秒里 Workday 只做得完二十来个,挑多了也只是占名额:
// 2026-10-23 慢跳时代积压的 535 个 Workday 板块(最早到期)把 300 个名额全占了,Greenhouse / Workable
// 等到期板块排了一个多小时。
export const DUE_PER_FAMILY = 100;
export interface DueOpts { now: Date; limit: number; perFamily?: number; families?: Family[]; skipFamilies?: Family[]; tiers?: Tier[]; keys?: string[]; localHour: number; }
// 到期板块:静音和 chrome 家族永不入选;LinkedIn 只在本地 08:00–22:00;顺序 core → longtail → dormant,
// 同层清单优先,再按到期时间早者先;每个 family 最多 perFamily 个(默认 DUE_PER_FAMILY)。
export function dueBoards(db: DB, o: DueOpts): BoardRow[] {
  const conds = ["tier <> 'muted'", "family <> 'chrome'", "(next_due_at IS NULL OR next_due_at <= ?)"];
  const params: unknown[] = [iso(o.now)];
  const inList = (col: string, vals?: string[]) => { if (vals?.length) { conds.push(`${col} IN (${vals.map(() => "?").join(",")})`); params.push(...vals); } };
  inList("family", o.families); inList("tier", o.tiers); inList("key", o.keys);
  if (o.skipFamilies?.length) { conds.push(`family NOT IN (${o.skipFamilies.map(() => "?").join(",")})`); params.push(...o.skipFamilies); }
  if (o.localHour < 8 || o.localHour >= 22) conds.push("family <> 'linkedin'");
  params.push(o.perFamily ?? DUE_PER_FAMILY, o.limit);
  const order = `CASE tier WHEN 'core' THEN 0 WHEN 'longtail' THEN 1 ELSE 2 END,
              CASE family WHEN 'github_list' THEN 0 ELSE 1 END,
              COALESCE(next_due_at, '') ASC, id ASC`;
  const rows = db.prepare(
    `SELECT * FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY family ORDER BY ${order}) AS family_rank
       FROM boards WHERE ${conds.join(" AND ")}
     ) WHERE family_rank <= ?
     ORDER BY ${order}
     LIMIT ?`
  ).all(...params) as (BoardRow & { family_rank?: number })[];
  return rows.map(({ family_rank: _rank, ...b }) => b);
}

export function nextDueAfter(tier: Tier, failCount: number, now: Date, rand: () => number = Math.random, family?: Family): string | null {
  if (tier === "muted") return null;
  const jitter = 0.9 + rand() * 0.2;                       // ±10%,让几百个核心板块别挤在同一分钟
  const backoff = failCount > 0 ? 2 ** Math.min(failCount, 3) : 1;
  const mult = (family && FAMILY_CADENCE_MULTIPLIER[family]) || 1;
  return iso(new Date(now.getTime() + CADENCE_MS[tier] * mult * jitter * backoff));
}

// retryAfterMs:429 时对方给的 Retry-After(调度器从错误消息里读出、已夹在合理范围内);没给就明天再问。
// truncated:适配器到了截止时刻提前收手(还有新岗没拉详情)→ 最晚一小时后再问,不用等一整个周期
// (长尾 Workday 的周期是 3 天)。
export interface PollOutcome { ok: boolean; error?: string; httpStatus?: number | null; retryAfterMs?: number | null; truncated?: boolean; now: Date; rand?: () => number; }
export const TRUNCATED_REDUE_MS = 3600_000;

const statusIn = (msg: string | null | undefined): number | null => { const m = (msg ?? "").match(/HTTP (\d{3})/); return m ? Number(m[1]) : null; };
const parseMeta = (meta: string | null): Record<string, unknown> => { try { return meta ? (JSON.parse(meta) as Record<string, unknown>) : {}; } catch { return {}; } };
const dbTime = (s: string): number => new Date(s.replace(" ", "T") + "Z").getTime();

// 这次失败之后的「同一状态连续失败」记录(存在 boards.meta.fail_streak)。不该计数的失败原样保留上一条。
// 老板块第一次走到这里时还没有记录:上一次的错误就是同一个状态的话,把 fail_count 当作连续次数、
// 上次成功(从没成功过就是建档时间)当作开始 —— 上线当天就能认出那几十个一直 422 的坏站点。
function nextStreak(b: BoardRow, prev: FailStreak | undefined, status: number | null, now: string): FailStreak | null | undefined {
  if (status === null || status < 400 || status === 429) return prev;
  if (status === 404) return null;                           // 404 有自己的规则
  if (prev && prev.status === status) return { status, n: prev.n + 1, since: prev.since };
  if (!prev && b.fail_count > 0 && statusIn(b.last_error) === status) return { status, n: b.fail_count + 1, since: b.last_ok_at ?? b.created_at };
  return { status, n: 1, since: now };
}

export function markBoardResult(db: DB, key: string, o: PollOutcome): void {
  const b = getBoard(db, key);
  if (!b) return;
  const now = iso(o.now);
  const meta = parseMeta(b.meta);
  const prevStreak = meta.fail_streak as FailStreak | undefined;
  if (o.ok) {
    let metaOut = b.meta;
    if (prevStreak) { delete meta.fail_streak; metaOut = JSON.stringify(meta); }
    const regular = nextDueAfter(b.tier, 0, o.now, o.rand, b.family);
    const soon = iso(new Date(o.now.getTime() + TRUNCATED_REDUE_MS));
    const nextDue = o.truncated && regular !== null && soon < regular ? soon : regular;
    db.prepare("UPDATE boards SET fail_count=0, last_polled_at=?, last_ok_at=?, last_error=NULL, next_due_at=?, meta=?, updated_at=datetime('now') WHERE key=?")
      .run(now, now, nextDue, metaOut, key);
    return;
  }
  const failCount = b.fail_count + 1;
  const status = o.httpStatus ?? statusIn(o.error);
  const is404 = status === 404;
  const streak404 = is404 && (b.fail_count === 0 || /HTTP 404/.test(b.last_error ?? ""));
  const canMute = b.tier_locked === 0 && b.tier !== "muted";
  const streak = nextStreak(b, prevStreak, status, now);
  const streakDays = streak ? (o.now.getTime() - dbTime(streak.since)) / 86_400_000 : 0;
  let reason: string | null = null;
  if (canMute && streak404 && failCount >= MAX_404_STREAK) reason = `404 x${failCount}`;
  else if (canMute && streak && streak.n >= PERSISTENT_FAIL_STREAK && streakDays >= PERSISTENT_FAIL_DAYS) reason = `HTTP ${streak.status} x${streak.n} over ${Math.floor(streakDays)}d`;
  const mute = reason !== null;
  if (streak) meta.fail_streak = streak; else delete meta.fail_streak;
  const metaOut = streak || prevStreak ? JSON.stringify(meta) : b.meta;
  // 429 = 对方限流:按 Retry-After(没给就 24 小时)再问。其余失败按 2^n 退避(封顶 8 倍)。
  const nextDue = mute ? null : status === 429 ? iso(new Date(o.now.getTime() + (o.retryAfterMs ?? 24 * 3600_000))) : nextDueAfter(b.tier, failCount, o.now, o.rand, b.family);
  db.prepare("UPDATE boards SET fail_count=?, last_polled_at=?, last_error=?, next_due_at=?, tier=?, tier_reason=?, meta=?, updated_at=datetime('now') WHERE key=?")
    .run(failCount, now, (o.error ?? "error").slice(0, 300), nextDue, mute ? "muted" : b.tier, mute ? reason : b.tier_reason, metaOut, key);
  if (mute) logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key, from: b.tier, to: "muted", reason } });
}

export function mergeBoardMeta(db: DB, key: string, patch: Record<string, unknown>): void {
  const b = getBoard(db, key);
  if (!b) return;
  let cur: Record<string, unknown> = {};
  try { cur = b.meta ? (JSON.parse(b.meta) as Record<string, unknown>) : {}; } catch { cur = {}; }
  db.prepare("UPDATE boards SET meta=?, updated_at=datetime('now') WHERE key=?").run(JSON.stringify({ ...cur, ...patch }), key);
}

// 执行器在活页面上发现整个板块没了(例如 Ashby 的公司页 404):静音,不锁定(用户仍可在来源页手动改回)。
// 已经静音的不动;没有这行的 key(老岗位没解析出板块)静默忽略。
export function muteBoard(db: DB, key: string, reason: string): void {
  const b = getBoard(db, key);
  if (!b || b.tier === "muted") return;
  db.prepare("UPDATE boards SET tier='muted', tier_reason=?, next_due_at=NULL, updated_at=datetime('now') WHERE key=?").run(reason.slice(0, 200), key);
  logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key, from: b.tier, to: "muted", reason } });
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
