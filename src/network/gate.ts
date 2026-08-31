import { DB } from "@/lib/db";
import { appendThread } from "@/network/crm";

// Outreach send gate (Plan 5 §7, same red-line shape as the apply-executor gate in
// src/apply/queue.ts): the App is the only thing that may move an outreach row to 'sent', and it
// will only do that for a row a human explicitly approved. A Claude-in-Chrome executor session
// (.claude/skills/network-executor, Task 5) is the "hands" — it polls sendables(), sends exactly
// what's there, and reports back through reportSent/reportReply. Both sides only ever talk
// through localhost API + SQLite.
//
// State machine on outreach.status: draft -> pending_send -> sent -> replied
// (draft -> archived is the reject path, a dead end.)

interface StatusRow {
  status: string;
  draft: string | null;
}

function getStatus(db: DB, id: number): StatusRow {
  const row = db.prepare("SELECT status, draft FROM outreach WHERE id = ?").get(id) as StatusRow | undefined;
  if (!row) throw new Error(`network/gate: unknown outreach ${id}`);
  return row;
}

// User approves a drafted message from the CRM UI. Only a 'draft' row may be approved — this is
// what actually admits it to the send queue (sendables()).
export function approveOutreach(db: DB, id: number): void {
  const row = getStatus(db, id);
  if (row.status !== "draft") {
    throw new Error(`approveOutreach: cannot approve from status '${row.status}' (must be 'draft')`);
  }
  db.prepare("UPDATE outreach SET status = 'pending_send' WHERE id = ?").run(id);
}

// User rejects a drafted message. Parks it at 'archived' with outcome='rejected' — a dead end,
// distinct from the send pipeline entirely (unlike apply's reject-and-reoffer, there's no retry
// path here; the user can always generate a fresh draft for the same person/playbook).
export function rejectOutreach(db: DB, id: number): void {
  const row = getStatus(db, id);
  if (row.status !== "draft") {
    throw new Error(`rejectOutreach: cannot reject from status '${row.status}' (must be 'draft')`);
  }
  db.prepare("UPDATE outreach SET status = 'archived', outcome = 'rejected' WHERE id = ?").run(id);
}

// Lets the user (or Task 4's UI) edit the draft text before approving. Only while status='draft'
// — once approved/sent, the draft is what was (or will be) actually sent and must not silently
// change out from under an in-flight approval/send.
export function updateDraft(db: DB, id: number, draft: string): void {
  const row = getStatus(db, id);
  if (row.status !== "draft") {
    throw new Error(`updateDraft: cannot edit draft from status '${row.status}' (must be 'draft')`);
  }
  db.prepare("UPDATE outreach SET draft = ? WHERE id = ?").run(draft, id);
}

export interface SendableRow {
  id: number;
  personId: number;
  personName: string;
  linkedinUrl: string | null;
  email: string | null;
  channel: string;
  playbook: string;
  draft: string | null;
  jobId: number | null;
}

interface SendableRawRow {
  id: number;
  person_id: number;
  person_name: string;
  linkedin_url: string | null;
  email: string | null;
  channel: string;
  playbook: string;
  draft: string | null;
  job_id: number | null;
}

// Executor's polling endpoint: every outreach the user has approved and is waiting to be sent,
// joined with just the person fields the executor needs (linkedin_url to open, email as a
// mailto: fallback) — it never needs to touch the people table directly.
export function sendables(db: DB): SendableRow[] {
  const rows = db
    .prepare(
      `SELECT o.id, o.person_id, p.name as person_name, p.linkedin_url, p.email,
              o.channel, o.playbook, o.draft, o.job_id
       FROM outreach o JOIN people p ON p.id = o.person_id
       WHERE o.status = 'pending_send'
       ORDER BY o.created_at ASC`
    )
    .all() as SendableRawRow[];
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    personName: r.person_name,
    linkedinUrl: r.linkedin_url,
    email: r.email,
    channel: r.channel,
    playbook: r.playbook,
    draft: r.draft,
    jobId: r.job_id,
  }));
}

// RED LINE: the only path to status='sent'. Throws unless the outreach is sitting at
// 'pending_send' — i.e. a human already approved it via approveOutreach. This is the App-side
// half of the double lock; the executor skill's own protocol (only ever send what sendables()
// returned, verbatim) is the other half.
export function reportSent(db: DB, id: number): void {
  const row = getStatus(db, id);
  if (row.status !== "pending_send") {
    throw new Error(
      `reportSent red line: outreach ${id} is not approved+pending_send (status=${row.status})`
    );
  }
  db.prepare("UPDATE outreach SET status = 'sent' WHERE id = ?").run(id);
  appendThread(db, id, { dir: "sent", text: row.draft ?? "" });
}

// Reply-harvesting: records an incoming reply and advances sent -> replied. Only valid from
// 'sent' — a reply to something never reported as sent (or already replied/archived) has no
// well-defined prior state to advance from.
export function reportReply(db: DB, id: number, text: string): void {
  const row = getStatus(db, id);
  if (row.status !== "sent") {
    throw new Error(`reportReply: cannot record a reply from status '${row.status}' (must be 'sent')`);
  }
  db.prepare("UPDATE outreach SET status = 'replied' WHERE id = ?").run(id);
  appendThread(db, id, { dir: "received", text });
}
