import { DB, logEvent } from "@/lib/db";

// 每天的 LinkedIn 邀请额度(2026-10-16,用户定的)。之前只有「每段最多 10 条」,可接力一段接一段地跑,
// 等于没有每天的上限:10-16 凌晨任务 #449–#452 一个半小时发了 35 条带留言的邀请,第 5 段的会话怕
// LinkedIn 限流封号,自己把任务停了、在摘要里写了三个选项「等你决定」——界面上没有任何地方让用户选,
// 接力就此断了 11 个小时,计划里的 1200 份海投一份没开始。现在节奏由 App 定:每天(服务器本地日)
// 最多 DAILY_INVITE_LIMIT 条,用完了批量内推取件就返回 {done, reason:'invite_budget'},会话跳过
// 内推条目去做海投;第二天自动接着找内推(src/apply/continue.ts)。LinkedIn 自己弹出限流 / 验证提示时,
// 会话报一声(POST /api/referral/invite-budget),当天剩下的额度清零。
//
// 「一条邀请」= 一个内推联系人的第一条 LinkedIn 消息:当天发出的,加上当天起草、还没发的(已经答应要
// 发,不算进来就会超)。1 度好友的私信不占邀请名额,但分不出来也很少见,一并算上,宁紧勿松。
// 后续跟进(outreach_followups)不是邀请,不算。

export const DAILY_INVITE_LIMIT = 20;
export const COOLDOWN_KEY_PREFIX = "linkedin_cooldown:";

export function dailyInviteLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LINKEDIN_DAILY_INVITES;
  if (raw == null || raw.trim() === "") return DAILY_INVITE_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DAILY_INVITE_LIMIT;
}

// The server's local calendar day (the always-on box runs on Los Angeles time), like 今日已提交.
export function localDayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
export function nextLocalMidnight(now: Date): Date {
  const d = localDayStart(now);
  d.setDate(d.getDate() + 1);
  return d;
}

// SQLite's datetime('now') text is UTC without a zone ("2026-10-16 07:21:15").
function sqliteUtcMs(s: string): number {
  return Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}

function firstSentMs(threadLog: string): number | null {
  let log: { dir?: string; at?: string }[] = [];
  try {
    log = JSON.parse(threadLog || "[]");
  } catch {
    return null;
  }
  let first: number | null = null;
  for (const e of Array.isArray(log) ? log : []) {
    if (e?.dir !== "sent" || typeof e.at !== "string") continue;
    const t = Date.parse(e.at);
    if (Number.isFinite(t) && (first == null || t < first)) first = t;
  }
  return first;
}

export function invitesUsedToday(db: DB, userId: string, now: Date = new Date()): number {
  const start = localDayStart(now).getTime();
  const end = nextLocalMidnight(now).getTime();
  const rows = db
    .prepare(
      `SELECT status, created_at, thread_log FROM outreach
       WHERE user_id = ? AND playbook = 'referral' AND channel = 'linkedin'
         AND (status IN ('draft','pending_send') OR thread_log LIKE '%"dir":"sent"%')`
    )
    .all(userId) as { status: string; created_at: string; thread_log: string }[];
  let n = 0;
  for (const r of rows) {
    const sent = firstSentMs(r.thread_log);
    const at = sent ?? (r.status === "draft" || r.status === "pending_send" ? sqliteUtcMs(r.created_at) : NaN);
    if (at >= start && at < end) n += 1;
  }
  return n;
}

export interface InviteBudget {
  limit: number;
  used: number;
  left: number;
  exhausted: boolean;
  // LinkedIn itself asked to slow down today (the session reported a rate-limit / verification prompt).
  cooldownUntil: string | null;
  // When referrals pick up again (ISO): the next local midnight.
  resetsAt: string;
}

function cooldownOf(db: DB, userId: string, now: Date): string | null {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(COOLDOWN_KEY_PREFIX + userId) as { value: string } | undefined;
  return row && Date.parse(row.value) > now.getTime() ? row.value : null;
}

export function inviteBudget(db: DB, userId: string, now: Date = new Date(), env: Record<string, string | undefined> = process.env): InviteBudget {
  const limit = dailyInviteLimit(env);
  const used = invitesUsedToday(db, userId, now);
  const cooldownUntil = cooldownOf(db, userId, now);
  const left = cooldownUntil ? 0 : Math.max(0, limit - used);
  return { limit, used, left, exhausted: left <= 0, cooldownUntil, resetsAt: nextLocalMidnight(now).toISOString() };
}

// The session saw LinkedIn's own brakes (weekly invite limit reached, "verify you're human",
// unusual-activity notice): no more invites until tomorrow, whatever the count says.
export function markInviteCooldown(db: DB, userId: string, reason: string, now: Date = new Date()): InviteBudget {
  const until = nextLocalMidnight(now).toISOString();
  db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(COOLDOWN_KEY_PREFIX + userId, until);
  logEvent(db, "linkedin_invite_cooldown", { userId, payload: { until, reason: reason.slice(0, 300) } });
  return inviteBudget(db, userId, now);
}

// What the session reads when the budget stops it (ASCII: it goes straight into its log lines).
export function inviteBudgetMessage(b: InviteBudget): string {
  const why = b.cooldownUntil ? "LinkedIn asked to slow down today" : `today's LinkedIn invite budget (${b.used}/${b.limit}) is used up`;
  return `${why}: contact nobody else on LinkedIn today. Skip the plan's remaining referral entries and go on with its direct ones; finish the segment normally as always. The App picks referrals up again tomorrow by itself - do not stop the task or ask the user.`;
}

// The budget paces the plan's batch referral hunt. A targeted referral run the user started from a
// card (换人再问 at one company) is exempt: one company, and the user asked for it just now.
export function isTargetedReferral(db: DB, userId: string, jobIds: number[]): boolean {
  if (jobIds.length === 0) return false;
  const row = db
    .prepare("SELECT r.options FROM applications a JOIN executor_runs r ON r.id = a.run_id WHERE a.user_id = ? AND a.job_id = ?")
    .get(userId, jobIds[0]) as { options: string } | undefined;
  if (!row) return false;
  try {
    const o = JSON.parse(row.options) as { jobIds?: unknown };
    return Array.isArray(o.jobIds) && o.jobIds.length > 0;
  } catch {
    return false;
  }
}

// Jobs a batch took for a company where the budget then ran out before anyone was contacted
// (another task spent the last invites meanwhile): back to the queue for tomorrow, instead of
// sitting in 内推进行中 with nobody asked.
export function releaseUncontacted(db: DB, userId: string, jobIds: number[]): number[] {
  const released: number[] = [];
  const stmt = db.prepare(
    `UPDATE applications SET status = 'matched', run_id = NULL
     WHERE user_id = ? AND job_id = ? AND status = 'referral_seeking'
       AND NOT EXISTS (SELECT 1 FROM outreach_jobs oj JOIN outreach o ON o.id = oj.outreach_id
                       WHERE oj.job_id = applications.job_id AND o.user_id = applications.user_id AND o.status <> 'archived')`
  );
  db.transaction(() => {
    for (const id of jobIds) if (stmt.run(userId, id).changes > 0) released.push(id);
  })();
  return released;
}
