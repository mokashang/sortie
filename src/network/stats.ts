import { DB } from "@/lib/db";

// Dashboard stats (Plan 5 §10). Every function here is a pure, read-only SQL query (plus, for
// staleFollowups, a bit of read-only JS post-processing over thread_log JSON — SQLite has no
// convenient way to pull the max of a JSON array's timestamps in plain SQL). Nothing here writes
// to the db.

// ---- funnel -----------------------------------------------------------------------------

export interface Funnel {
  discovered: number;
  matched: number;
  submitted: number;
  oa: number;
  interview: number;
  offer: number;
  rejected: number;
  archived: number;
}

// applications.status counted for exactly the 8 named funnel stages. Other real statuses
// (prepared, awaiting_confirm, stale) are intermediate/operational states the dashboard's funnel
// doesn't surface as their own stage — they simply aren't counted here (see todo() for
// awaiting_confirm's own place, the "去确认" row).
const FUNNEL_STATUSES: (keyof Funnel)[] = [
  "discovered",
  "matched",
  "submitted",
  "oa",
  "interview",
  "offer",
  "rejected",
  "archived",
];

export function funnel(db: DB): Funnel {
  const rows = db
    .prepare("SELECT status, COUNT(*) as n FROM applications GROUP BY status")
    .all() as { status: string; n: number }[];
  const counts = new Map(rows.map((r) => [r.status, r.n]));
  const result = {} as Funnel;
  for (const key of FUNNEL_STATUSES) result[key] = counts.get(key) ?? 0;
  return result;
}

// ---- byDirection --------------------------------------------------------------------------

export interface DirectionRow {
  direction: string | null;
  tier: number | null;
  total: number;
  submitted: number;
  interviews: number;
}

// One row per (direction, tier) bucket seen in `matches`, joined to each match's application.
// - total: every matched job in that bucket, regardless of current application status.
// - submitted: application.submitted_at IS NOT NULL — "ever submitted" rather than
//   "status literally = submitted", so a job that has since advanced to oa/interview/offer/
//   rejected still counts (submitted_at is a one-way marker, unlike status which moves on).
// - interviews: status IN ('interview','offer') — reached interview stage or beyond.
export function byDirection(db: DB): DirectionRow[] {
  const rows = db
    .prepare(
      `SELECT m.direction as direction, m.tier as tier,
              COUNT(*) as total,
              SUM(CASE WHEN a.submitted_at IS NOT NULL THEN 1 ELSE 0 END) as submitted,
              SUM(CASE WHEN a.status IN ('interview','offer') THEN 1 ELSE 0 END) as interviews
       FROM matches m
       JOIN applications a ON a.job_id = m.job_id
       GROUP BY m.direction, m.tier
       ORDER BY m.direction IS NULL ASC, m.tier ASC, m.direction ASC`
    )
    .all() as { direction: string | null; tier: number | null; total: number; submitted: number; interviews: number }[];
  return rows.map((r) => ({
    direction: r.direction,
    tier: r.tier,
    total: r.total,
    submitted: r.submitted,
    interviews: r.interviews,
  }));
}

// ---- networkingFunnel ----------------------------------------------------------------------

export interface NetworkingFunnel {
  drafts: number;
  pending: number;
  sent: number;
  replied: number;
  meetings: number;
  referrals: number;
}

// outreach.status counted for 6 of the 8 real statuses — no_response and archived are dead-end
// outcomes, not stages of the "is this working" funnel the dashboard wants to show.
const NETWORKING_STATUS_MAP: Record<keyof NetworkingFunnel, string> = {
  drafts: "draft",
  pending: "pending_send",
  sent: "sent",
  replied: "replied",
  meetings: "meeting",
  referrals: "referral_won",
};

export function networkingFunnel(db: DB): NetworkingFunnel {
  const rows = db
    .prepare("SELECT status, COUNT(*) as n FROM outreach GROUP BY status")
    .all() as { status: string; n: number }[];
  const counts = new Map(rows.map((r) => [r.status, r.n]));
  const result = {} as NetworkingFunnel;
  for (const key of Object.keys(NETWORKING_STATUS_MAP) as (keyof NetworkingFunnel)[]) {
    result[key] = counts.get(NETWORKING_STATUS_MAP[key]) ?? 0;
  }
  return result;
}

// ---- crossStats -----------------------------------------------------------------------------

export interface CrossBucket {
  submitted: number;
  interviews: number;
}

export interface CrossStats {
  withReferral: CrossBucket;
  without: CrossBucket;
}

// applications split on referral_person_id IS NOT NULL vs IS NULL (§7.4's bidirectional link:
// an application can point back at the outreach/person that produced it). Same submitted/
// interviews definitions as byDirection above, for a like-for-like referral vs. cold comparison.
function crossBucket(db: DB, hasReferral: boolean): CrossBucket {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) as submitted,
         SUM(CASE WHEN status IN ('interview','offer') THEN 1 ELSE 0 END) as interviews
       FROM applications
       WHERE referral_person_id IS ${hasReferral ? "NOT NULL" : "NULL"}`
    )
    .get() as { submitted: number | null; interviews: number | null };
  return { submitted: row.submitted ?? 0, interviews: row.interviews ?? 0 };
}

export function crossStats(db: DB): CrossStats {
  return { withReferral: crossBucket(db, true), without: crossBucket(db, false) };
}

// ---- weekly ---------------------------------------------------------------------------------

export interface WeekBucket {
  submittedApplications: number;
  newOutreach: number;
}

export interface Weekly {
  thisWeek: WeekBucket;
  lastWeek: WeekBucket;
}

// Rolling 7-day windows anchored on "now" (not calendar weeks) — thisWeek = last 7 days,
// lastWeek = the 7 days before that. Avoids Sunday/Monday-start ambiguity and stays simple to
// reason about ("how much happened in the last week vs. the week before").
export function weekly(db: DB): Weekly {
  const submitted = db
    .prepare(
      `SELECT
         SUM(CASE WHEN julianday('now') - julianday(submitted_at) < 7 THEN 1 ELSE 0 END) as thisWeek,
         SUM(CASE WHEN julianday('now') - julianday(submitted_at) >= 7
                   AND julianday('now') - julianday(submitted_at) < 14 THEN 1 ELSE 0 END) as lastWeek
       FROM applications WHERE submitted_at IS NOT NULL`
    )
    .get() as { thisWeek: number | null; lastWeek: number | null };

  const outreach = db
    .prepare(
      `SELECT
         SUM(CASE WHEN julianday('now') - julianday(created_at) < 7 THEN 1 ELSE 0 END) as thisWeek,
         SUM(CASE WHEN julianday('now') - julianday(created_at) >= 7
                   AND julianday('now') - julianday(created_at) < 14 THEN 1 ELSE 0 END) as lastWeek
       FROM outreach`
    )
    .get() as { thisWeek: number | null; lastWeek: number | null };

  return {
    thisWeek: { submittedApplications: submitted.thisWeek ?? 0, newOutreach: outreach.thisWeek ?? 0 },
    lastWeek: { submittedApplications: submitted.lastWeek ?? 0, newOutreach: outreach.lastWeek ?? 0 },
  };
}

// ---- todo -----------------------------------------------------------------------------------

export interface StaleFollowup {
  outreachId: number;
  personName: string;
  personCompany: string | null;
  daysSince: number;
}

export interface Todo {
  pendingConfirms: number;
  pendingSends: number;
  staleFollowups: StaleFollowup[];
}

const STALE_DAYS = 5;

export function todo(db: DB): Todo {
  const pendingConfirms = (
    db.prepare("SELECT COUNT(*) as n FROM applications WHERE status = 'awaiting_confirm'").get() as { n: number }
  ).n;

  // "去批准" — outreach drafts still waiting on the user's approve/reject decision (the thing
  // blocking anything from ever reaching pending_send/sent). Named pendingSends per the plan's
  // signature, read as "outreach pending [being cleared to] send".
  const pendingSends = (
    db.prepare("SELECT COUNT(*) as n FROM outreach WHERE status = 'draft'").get() as { n: number }
  ).n;

  // Stale followups: status='sent' (no reply yet — 'replied' rows are excluded entirely,
  // regardless of age) whose most recent thread_log entry with dir='sent' is more than
  // STALE_DAYS days old. thread_log is JSON, so this last bit is done in JS after a plain
  // read-only SELECT rather than in SQL.
  const sentRows = db
    .prepare(
      `SELECT o.id as id, o.thread_log as thread_log, p.name as person_name, p.company as person_company
       FROM outreach o JOIN people p ON p.id = o.person_id
       WHERE o.status = 'sent'`
    )
    .all() as { id: number; thread_log: string; person_name: string; person_company: string | null }[];

  const staleFollowups: StaleFollowup[] = [];
  const now = Date.now();
  for (const row of sentRows) {
    let log: { at: string; dir: string; text: string }[] = [];
    try {
      log = JSON.parse(row.thread_log || "[]");
    } catch {
      log = [];
    }
    const lastSent = [...log].reverse().find((e) => e.dir === "sent");
    if (!lastSent) continue;
    const sentAt = new Date(lastSent.at.replace(" ", "T") + (lastSent.at.includes("Z") ? "" : "Z")).getTime();
    if (Number.isNaN(sentAt)) continue;
    const daysSince = (now - sentAt) / (24 * 60 * 60 * 1000);
    if (daysSince > STALE_DAYS) {
      staleFollowups.push({
        outreachId: row.id,
        personName: row.person_name,
        personCompany: row.person_company,
        daysSince: Math.floor(daysSince),
      });
    }
  }
  staleFollowups.sort((a, b) => b.daysSince - a.daysSince);

  return { pendingConfirms, pendingSends, staleFollowups };
}
