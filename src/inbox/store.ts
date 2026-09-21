import type { DB } from "@/lib/db";
import { POST_SUBMIT_STAGES } from "@/apply/stages";
import type { ClassifyApplication, MailOutcome } from "@/inbox/classify";

// Persistence for 邮箱同步 (spec 2026-09-21 inbox-sync §4): the connected mailbox per account and
// the ledger of mails the classifier looked at. Every query is scoped by user_id.

export interface MailAccountRow {
  userId: string;
  provider: string;
  email: string | null;
  refreshToken: string;
  scope: string | null;
  connectedAt: string;
  syncedAt: string | null;
  watermark: number | null;
  lastError: string | null;
  enabled: boolean;
}

interface MailAccountRaw {
  user_id: string;
  provider: string;
  email: string | null;
  refresh_token: string;
  scope: string | null;
  connected_at: string;
  synced_at: string | null;
  watermark: number | null;
  last_error: string | null;
  enabled: number;
}

function rowOf(r: MailAccountRaw): MailAccountRow {
  return {
    userId: r.user_id,
    provider: r.provider,
    email: r.email,
    refreshToken: r.refresh_token,
    scope: r.scope,
    connectedAt: r.connected_at,
    syncedAt: r.synced_at,
    watermark: r.watermark,
    lastError: r.last_error,
    enabled: r.enabled === 1,
  };
}

export function getMailAccount(db: DB, userId: string): MailAccountRow | null {
  const r = db.prepare("SELECT * FROM mail_accounts WHERE user_id = ?").get(userId) as MailAccountRaw | undefined;
  return r ? rowOf(r) : null;
}

export function listEnabledMailAccounts(db: DB): MailAccountRow[] {
  return (db.prepare("SELECT * FROM mail_accounts WHERE enabled = 1 ORDER BY user_id").all() as MailAccountRaw[]).map(rowOf);
}

// Connecting again replaces the token and clears any stale error, but keeps the sync cursor so
// a reconnect after a revoked grant does not re-read a month of mail.
export function upsertMailAccount(db: DB, a: { userId: string; email: string | null; refreshToken: string; scope: string | null }): void {
  db.prepare(
    `INSERT INTO mail_accounts (user_id, provider, email, refresh_token, scope, enabled)
     VALUES (?, 'google', ?, ?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, scope = excluded.scope,
       enabled = 1, last_error = NULL, connected_at = datetime('now')`
  ).run(a.userId, a.email, a.refreshToken, a.scope);
}

export function deleteMailAccount(db: DB, userId: string): boolean {
  return db.prepare("DELETE FROM mail_accounts WHERE user_id = ?").run(userId).changes > 0;
}

export function markSynced(db: DB, userId: string, watermark: number): void {
  db.prepare("UPDATE mail_accounts SET synced_at = datetime('now'), watermark = ?, last_error = NULL WHERE user_id = ?").run(watermark, userId);
}

export function markSyncError(db: DB, userId: string, error: string): void {
  db.prepare("UPDATE mail_accounts SET last_error = ? WHERE user_id = ?").run(error.slice(0, 500), userId);
}

// ---- events -----------------------------------------------------------------------------

export interface MailEventInput {
  userId: string;
  messageId: string;
  threadId: string | null;
  receivedAt: string; // UTC 'YYYY-MM-DD HH:MM:SS'
  from: string;
  subject: string;
  snippet: string;
  jobId: number | null;
  outcome: MailOutcome;
  confidence: number;
  summary: string;
  nextStep: string | null;
  applied: boolean;
  stageFrom: string | null;
  stageTo: string | null;
}

export function hasMailEvent(db: DB, userId: string, messageId: string): boolean {
  return !!db.prepare("SELECT 1 FROM mail_events WHERE user_id = ? AND message_id = ?").get(userId, messageId);
}

export function insertMailEvent(db: DB, e: MailEventInput): number {
  return db
    .prepare(
      `INSERT INTO mail_events (user_id, message_id, thread_id, received_at, from_addr, subject, snippet, job_id, outcome, confidence, summary, next_step, applied, stage_from, stage_to)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, message_id) DO NOTHING`
    )
    .run(
      e.userId,
      e.messageId,
      e.threadId,
      e.receivedAt,
      e.from.slice(0, 300),
      e.subject.slice(0, 300),
      e.snippet.slice(0, 300),
      e.jobId,
      e.outcome,
      e.confidence,
      e.summary.slice(0, 400),
      e.nextStep ? e.nextStep.slice(0, 400) : null,
      e.applied ? 1 : 0,
      e.stageFrom,
      e.stageTo
    ).lastInsertRowid as number;
}

export interface MailEventRow {
  id: number;
  messageId: string;
  threadId: string | null;
  receivedAt: string; // local 'YYYY-MM-DD HH:MM'
  from: string;
  subject: string;
  snippet: string;
  jobId: number | null;
  company: string | null;
  title: string | null;
  outcome: MailOutcome;
  confidence: number | null;
  summary: string | null;
  nextStep: string | null;
  applied: boolean;
  stageFrom: string | null;
  stageTo: string | null;
}

interface MailEventRaw {
  id: number;
  message_id: string;
  thread_id: string | null;
  received_at: string;
  from_addr: string | null;
  subject: string | null;
  snippet: string | null;
  job_id: number | null;
  company: string | null;
  title: string | null;
  outcome: string;
  confidence: number | null;
  summary: string | null;
  next_step: string | null;
  applied: number;
  stage_from: string | null;
  stage_to: string | null;
}

function eventOf(r: MailEventRaw): MailEventRow {
  return {
    id: r.id,
    messageId: r.message_id,
    threadId: r.thread_id,
    receivedAt: r.received_at,
    from: r.from_addr ?? "",
    subject: r.subject ?? "",
    snippet: r.snippet ?? "",
    jobId: r.job_id,
    company: r.company,
    title: r.title,
    outcome: r.outcome as MailOutcome,
    confidence: r.confidence,
    summary: r.summary,
    nextStep: r.next_step,
    applied: r.applied === 1,
    stageFrom: r.stage_from,
    stageTo: r.stage_to,
  };
}

const EVENT_SELECT = `SELECT e.id, e.message_id, e.thread_id, strftime('%Y-%m-%d %H:%M', e.received_at, 'localtime') as received_at,
    e.from_addr, e.subject, e.snippet, e.job_id, j.company, j.title, e.outcome, e.confidence, e.summary, e.next_step, e.applied, e.stage_from, e.stage_to
  FROM mail_events e LEFT JOIN jobs j ON j.id = e.job_id`;

// The 历史 page's 邮件动态 feed: newest first, unrelated mails left out (they are noise the user
// did not ask to see; the count of them is still available via countMailEvents).
export function recentMailEvents(db: DB, userId: string, limit = 30): MailEventRow[] {
  return (
    db.prepare(`${EVENT_SELECT} WHERE e.user_id = ? AND e.outcome != 'unrelated' ORDER BY e.received_at DESC, e.id DESC LIMIT ?`).all(userId, limit) as MailEventRaw[]
  ).map(eventOf);
}

// The latest matched mail per application, for the row chips on 历史.
export function latestMailByJob(db: DB, userId: string): Map<number, MailEventRow> {
  const rows = (
    db
      .prepare(
        `${EVENT_SELECT} WHERE e.user_id = ? AND e.job_id IS NOT NULL AND e.outcome != 'unrelated'
         AND e.id = (SELECT id FROM mail_events x WHERE x.user_id = e.user_id AND x.job_id = e.job_id AND x.outcome != 'unrelated' ORDER BY x.received_at DESC, x.id DESC LIMIT 1)`
      )
      .all(userId) as MailEventRaw[]
  ).map(eventOf);
  const map = new Map<number, MailEventRow>();
  for (const r of rows) if (r.jobId != null) map.set(r.jobId, r);
  return map;
}

export function countMailEvents(db: DB, userId: string): { total: number; matched: number; applied: number } {
  const r = db
    .prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN job_id IS NOT NULL THEN 1 ELSE 0 END) as matched, SUM(applied) as applied FROM mail_events WHERE user_id = ?"
    )
    .get(userId) as { total: number; matched: number | null; applied: number | null };
  return { total: r.total, matched: r.matched ?? 0, applied: r.applied ?? 0 };
}

// ---- what the classifier matches against ------------------------------------------------

const STAGE_IN = `(${POST_SUBMIT_STAGES.map((s) => `'${s}'`).join(",")})`;

// Every application this account has actually sent out, newest first, capped so the prompt
// stays bounded (a mail about an application older than the cap is filed as unrelated — those
// are months old and have usually gone stale anyway).
export function submittedApplications(db: DB, userId: string, limit = 300): ClassifyApplication[] {
  const rows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, a.status, strftime('%Y-%m-%d', a.submitted_at, 'localtime') as submitted_day
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ? AND a.status IN ${STAGE_IN} AND a.submitted_at IS NOT NULL
       ORDER BY a.submitted_at DESC, a.job_id DESC LIMIT ?`
    )
    .all(userId, limit) as { job_id: number; company: string; title: string; status: string; submitted_day: string | null }[];
  return rows.map((r) => ({ jobId: r.job_id, company: r.company, title: r.title, status: r.status, submittedAt: r.submitted_day }));
}

// Unix seconds of the earliest submission, for the first sync's cursor.
export function earliestSubmissionUnix(db: DB, userId: string): number | null {
  const r = db
    .prepare(`SELECT CAST(strftime('%s', MIN(submitted_at)) AS INTEGER) as t FROM applications WHERE user_id = ? AND status IN ${STAGE_IN} AND submitted_at IS NOT NULL`)
    .get(userId) as { t: number | null } | undefined;
  return r?.t ?? null;
}
