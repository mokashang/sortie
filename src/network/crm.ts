import { z } from "zod";
import { DB } from "@/lib/db";

// Networking CRM data layer (Plan 5 §7). people/outreach tables already exist (Plan 1 schema.sql).
// This module is the only thing that touches those two tables directly — draft.ts, gate.ts, and
// the API routes all go through it.

export const RELATIONS = ["recruiter", "alum", "hiring_manager", "engineer", "other"] as const;
export type Relation = (typeof RELATIONS)[number];

export const PLAYBOOKS = [
  "referral",
  "self_pitch",
  "recruiter",
  "coffee_chat",
  "hidden_opportunity",
  "followup",
  "thanks",
] as const;
export type Playbook = (typeof PLAYBOOKS)[number];

export const CHANNELS = ["linkedin", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

// Legal outreach.status values. draft/pending_send/sent/replied/meeting/referral_won/no_response
// come from the schema.sql column comment; 'archived' is added here for gate.ts's rejectOutreach
// (draft -> archived) — it's a real reachable state even though the original column comment
// predates the send-gate design.
export const OUTREACH_STATUSES = [
  "draft",
  "pending_send",
  "sent",
  "replied",
  "meeting",
  "referral_won",
  "no_response",
  "archived",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const PersonInputSchema = z.object({
  name: z.string().min(1),
  company: z.string().min(1).nullable().optional(),
  role_title: z.string().min(1).nullable().optional(),
  linkedin_url: z.string().min(1).nullable().optional(),
  email: z.string().min(1).nullable().optional(),
  email_status: z.string().min(1).nullable().optional(), // guessed | verified (not enum-enforced upstream)
  relation: z.enum(RELATIONS).nullable().optional(),
  source: z.string().min(1).nullable().optional(),
});
export type PersonInput = z.infer<typeof PersonInputSchema>;

export interface Person {
  id: number;
  name: string;
  company: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  relation: string | null;
  source: string | null;
  created_at: string;
}

interface PersonRow {
  id: number;
  name: string;
  company: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  relation: string | null;
  source: string | null;
  created_at: string;
}

function rowToPerson(r: PersonRow): Person {
  return { ...r };
}

// Upsert keyed on linkedin_url (the table's UNIQUE column): when a non-empty linkedin_url
// matches an existing row, that row's id is returned and any currently-empty (null) fields on it
// are filled in from `input` — fields the existing row already has a value for are left alone.
// Without a linkedin_url there's no dedup key, so every call inserts a fresh row (e.g. the
// find-people executor mode may not have a profile URL yet).
export function upsertPerson(db: DB, input: PersonInput): number {
  const p = PersonInputSchema.parse(input);

  if (p.linkedin_url) {
    const existing = db
      .prepare("SELECT * FROM people WHERE linkedin_url = ?")
      .get(p.linkedin_url) as PersonRow | undefined;
    if (existing) {
      const merged = {
        company: existing.company ?? p.company ?? null,
        role_title: existing.role_title ?? p.role_title ?? null,
        email: existing.email ?? p.email ?? null,
        email_status: existing.email_status ?? p.email_status ?? null,
        relation: existing.relation ?? p.relation ?? null,
        source: existing.source ?? p.source ?? null,
      };
      db.prepare(
        `UPDATE people SET company = ?, role_title = ?, email = ?, email_status = ?, relation = ?, source = ? WHERE id = ?`
      ).run(merged.company, merged.role_title, merged.email, merged.email_status, merged.relation, merged.source, existing.id);
      return existing.id;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO people (name, company, role_title, linkedin_url, email, email_status, relation, source)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      p.name,
      p.company ?? null,
      p.role_title ?? null,
      p.linkedin_url ?? null,
      p.email ?? null,
      p.email_status ?? null,
      p.relation ?? null,
      p.source ?? null
    );
  return Number(info.lastInsertRowid);
}

export function listPeople(db: DB, filter?: { company?: string; relation?: string }): Person[] {
  let sql = "SELECT * FROM people WHERE 1=1";
  const params: unknown[] = [];
  if (filter?.company) {
    sql += " AND company = ?";
    params.push(filter.company);
  }
  if (filter?.relation) {
    sql += " AND relation = ?";
    params.push(filter.relation);
  }
  sql += " ORDER BY created_at DESC, id DESC";
  const rows = db.prepare(sql).all(...params) as PersonRow[];
  return rows.map(rowToPerson);
}

export const OutreachInputSchema = z.object({
  personId: z.number().int().positive(),
  jobId: z.number().int().positive().nullable().optional(),
  playbook: z.enum(PLAYBOOKS),
  channel: z.enum(CHANNELS),
  draft: z.string().nullable().optional(),
  // Referral-in-apply: one message may cover up to 3 jobs at the same company. Each id gets an
  // outreach_jobs row; job_id (the legacy single link) falls back to the first one.
  jobIds: z.array(z.number().int().positive()).max(3).optional(),
});
export type OutreachInput = z.infer<typeof OutreachInputSchema>;

export interface ThreadEntry {
  at: string; // ISO timestamp
  dir: "sent" | "received";
  text: string;
}

export interface OutreachRow {
  id: number;
  personId: number;
  personName: string;
  personCompany: string | null;
  jobId: number | null;
  playbook: string;
  channel: string;
  draft: string | null;
  threadLog: ThreadEntry[];
  status: string;
  outcome: string | null;
  createdAt: string;
}

interface OutreachRawRow {
  id: number;
  person_id: number;
  person_name: string;
  person_company: string | null;
  job_id: number | null;
  playbook: string;
  channel: string;
  draft: string | null;
  thread_log: string;
  status: string;
  outcome: string | null;
  created_at: string;
}

function rowToOutreach(r: OutreachRawRow): OutreachRow {
  let threadLog: ThreadEntry[] = [];
  try {
    threadLog = JSON.parse(r.thread_log || "[]");
  } catch {
    threadLog = [];
  }
  return {
    id: r.id,
    personId: r.person_id,
    personName: r.person_name,
    personCompany: r.person_company,
    jobId: r.job_id,
    playbook: r.playbook,
    channel: r.channel,
    draft: r.draft,
    threadLog,
    status: r.status,
    outcome: r.outcome,
    createdAt: r.created_at,
  };
}

// New outreach always starts life at status='draft' — the send gate (gate.ts) is the only thing
// allowed to move it forward from there.
export function createOutreach(db: DB, input: OutreachInput): number {
  const o = OutreachInputSchema.parse(input);
  const primary = o.jobId ?? o.jobIds?.[0] ?? null;
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO outreach (person_id, job_id, playbook, channel, draft, status)
         VALUES (?,?,?,?,?, 'draft')`
      )
      .run(o.personId, primary, o.playbook, o.channel, o.draft ?? null);
    const id = Number(info.lastInsertRowid);
    const link = db.prepare("INSERT OR IGNORE INTO outreach_jobs (outreach_id, job_id) VALUES (?,?)");
    for (const jobId of o.jobIds ?? []) link.run(id, jobId);
    return id;
  })();
}

// Every job an outreach covers, in insertion order (the primary first).
export function outreachJobIds(db: DB, outreachId: number): number[] {
  return (
    db.prepare("SELECT job_id FROM outreach_jobs WHERE outreach_id = ? ORDER BY rowid").all(outreachId) as { job_id: number }[]
  ).map((r) => r.job_id);
}

// Latest outreach that covers this job (via outreach_jobs, or the legacy single job_id column).
export function outreachForJob(db: DB, jobId: number): OutreachRow | null {
  const row = db
    .prepare(
      `SELECT o.*, p.name as person_name, p.company as person_company
       FROM outreach o JOIN people p ON p.id = o.person_id
       WHERE o.job_id = ? OR o.id IN (SELECT outreach_id FROM outreach_jobs WHERE job_id = ?)
       ORDER BY o.id DESC LIMIT 1`
    )
    .get(jobId, jobId) as OutreachRawRow | undefined;
  return row ? rowToOutreach(row) : null;
}

// SQL fragment (alias `o` = outreach): does this outreach belong to the referral pipeline?
export const JOB_LINKED_SQL = "(o.job_id IS NOT NULL OR EXISTS (SELECT 1 FROM outreach_jobs oj WHERE oj.outreach_id = o.id))";

// Appends one entry to thread_log's JSON array, stamped with the current time. Used both by the
// send gate (an approved draft's own text, once actually sent) and by reply-harvesting (a
// received message copied in from LinkedIn/email).
export function appendThread(db: DB, outreachId: number, entry: { dir: "sent" | "received"; text: string }): void {
  const row = db.prepare("SELECT thread_log FROM outreach WHERE id = ?").get(outreachId) as
    | { thread_log: string }
    | undefined;
  if (!row) throw new Error(`appendThread: unknown outreach ${outreachId}`);
  let log: ThreadEntry[] = [];
  try {
    log = JSON.parse(row.thread_log || "[]");
  } catch {
    log = [];
  }
  log.push({ at: new Date().toISOString(), dir: entry.dir, text: entry.text });
  db.prepare("UPDATE outreach SET thread_log = ? WHERE id = ?").run(JSON.stringify(log), outreachId);
}

export function listOutreach(
  db: DB,
  filter?: { personId?: number; jobId?: number; status?: string; jobLinked?: boolean }
): OutreachRow[] {
  let sql = `SELECT o.*, p.name as person_name, p.company as person_company
             FROM outreach o JOIN people p ON p.id = o.person_id WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.personId) {
    sql += " AND o.person_id = ?";
    params.push(filter.personId);
  }
  if (filter?.jobId) {
    sql += " AND (o.job_id = ? OR o.id IN (SELECT outreach_id FROM outreach_jobs WHERE job_id = ?))";
    params.push(filter.jobId, filter.jobId);
  }
  if (filter?.status) {
    sql += " AND o.status = ?";
    params.push(filter.status);
  }
  // jobLinked=false is /network's view (coffee chat / hidden opportunity only); true is the
  // referral pipeline's; undefined (the executor's sendables poll) sees everything.
  if (filter?.jobLinked === true) sql += ` AND ${JOB_LINKED_SQL}`;
  if (filter?.jobLinked === false) sql += ` AND NOT ${JOB_LINKED_SQL}`;
  sql += " ORDER BY o.created_at DESC, o.id DESC";
  const rows = db.prepare(sql).all(...params) as OutreachRawRow[];
  return rows.map(rowToOutreach);
}

export function setOutreachStatus(db: DB, id: number, status: string): void {
  if (!(OUTREACH_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`setOutreachStatus: invalid status '${status}' (must be one of ${OUTREACH_STATUSES.join(", ")})`);
  }
  const info = db.prepare("UPDATE outreach SET status = ? WHERE id = ?").run(status, id);
  if (info.changes === 0) throw new Error(`setOutreachStatus: unknown outreach ${id}`);
}
