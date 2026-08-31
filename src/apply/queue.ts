import { DB } from "@/lib/db";
import { Profile } from "@/lib/profile";
import { buildAnswerPack, AnswerPack } from "@/apply/answers";
import { selectResumeForJob } from "@/apply/resume-select";

// The apply-executor protocol: the App is the "brain" (this file's pure DB logic) and a
// Claude-in-Chrome session is the "hands" (drives the user's real, logged-in Chrome per
// .claude/skills/apply-executor). Both sides only ever talk through localhost API + SQLite.
//
// State machine on applications.status:
//   matched -> prepared -> awaiting_confirm -> submitted
// with `needs_manual_reason` acting as a "parked" flag: a matched-but-parked application is
// skipped by the picker (see the `needs_manual_reason IS NULL` filter below) until a human
// clears the reason, so it never gets re-offered in a tight loop. reportFill's needs_manual/error
// outcomes, and decide's reject outcome, all return status to 'matched' *with* a reason set —
// same parking mechanism, different callers.

export interface ApplyTask {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string;
  ats: string | null;
  answerPack: AnswerPack;
}

interface CandidateRow {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  ats: string | null;
}

// Picks the single highest-priority open application and prepares it for the executor:
// selects a resume, builds the answer pack, and advances matched -> prepared so a second call
// (or a concurrent executor) skips it. Jobs whose direction has no generated resume are parked
// (needs_manual_reason set, status left at 'matched') and the loop moves on to the next
// candidate — they never get returned to the caller as a task.
export function takeNextApplication(db: DB, profile: Profile): ApplyTask | { done: true } {
  for (;;) {
    const row = db
      .prepare(
        `SELECT j.id as job_id, j.company, j.title, j.apply_url, j.ats
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN matches m ON m.job_id = j.id
         WHERE a.status = 'matched' AND a.needs_manual_reason IS NULL
         ORDER BY COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC
         LIMIT 1`
      )
      .get() as CandidateRow | undefined;

    if (!row) return { done: true };

    const selection = selectResumeForJob(db, row.job_id);
    if ("error" in selection) {
      const reason =
        selection.direction != null
          ? `no resume generated for direction '${selection.direction}'`
          : "job has no matched direction";
      db.prepare("UPDATE applications SET needs_manual_reason = ? WHERE job_id = ?").run(reason, row.job_id);
      continue; // parked row now fails the needs_manual_reason IS NULL filter — try the next one.
    }

    const answerPack = buildAnswerPack(
      profile,
      { company: row.company, title: row.title, apply_url: row.apply_url },
      { version_name: selection.versionName, pdf_path: selection.pdfPath }
    );

    const tx = db.transaction(() => {
      db.prepare("UPDATE applications SET status = 'prepared', answer_pack = ? WHERE job_id = ? AND status = 'matched'").run(
        JSON.stringify(answerPack),
        row.job_id
      );
    });
    tx();

    return {
      jobId: row.job_id,
      company: row.company,
      title: row.title,
      applyUrl: row.apply_url ?? "",
      ats: row.ats,
      answerPack,
    };
  }
}

export interface ReportFillInput {
  jobId: number;
  status: "awaiting_confirm" | "needs_manual" | "error";
  filledFields?: Record<string, string>;
  reason?: string;
}

// Executor -> App status report. Only 'prepared' may transition; 'awaiting_confirm' is also
// accepted as a from-state so a retried/duplicate report is idempotent rather than a hard error.
export function reportFill(db: DB, input: ReportFillInput): void {
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(input.jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`reportFill: no application for job ${input.jobId}`);
  if (row.status !== "prepared" && row.status !== "awaiting_confirm") {
    throw new Error(`reportFill: cannot report from status '${row.status}' (must be 'prepared' or 'awaiting_confirm')`);
  }

  if (input.status === "awaiting_confirm") {
    db.prepare(
      "UPDATE applications SET filled_fields = ?, status = 'awaiting_confirm', confirm_decision = NULL WHERE job_id = ?"
    ).run(JSON.stringify(input.filledFields ?? {}), input.jobId);
    return;
  }

  // needs_manual | error: both park the application back at 'matched' with a reason recorded;
  // 'error' is distinguished only by an "error: " prefix so the confirmation UI/logs can tell
  // "executor gave up cleanly" apart from "something broke".
  const reason = input.status === "error" ? `error: ${input.reason ?? ""}` : input.reason ?? "";
  db.prepare("UPDATE applications SET needs_manual_reason = ?, status = 'matched' WHERE job_id = ?").run(
    reason,
    input.jobId
  );
}

// User's decision from the in-app confirmation queue. approve leaves status at
// 'awaiting_confirm' (reportSubmitted is the only thing allowed to move it past that — see the
// red line below); reject parks the application back at 'matched' like a needs_manual report.
export function decide(db: DB, jobId: number, decision: "approve" | "reject", reason?: string): void {
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`decide: no application for job ${jobId}`);
  if (row.status !== "awaiting_confirm") {
    throw new Error(`decide: cannot decide from status '${row.status}' (must be 'awaiting_confirm')`);
  }

  if (decision === "approve") {
    db.prepare("UPDATE applications SET confirm_decision = 'approved' WHERE job_id = ?").run(jobId);
    return;
  }

  db.prepare(
    "UPDATE applications SET status = 'matched', confirm_decision = 'rejected', needs_manual_reason = ? WHERE job_id = ?"
  ).run(reason ?? "user rejected fill", jobId);
}

// RED LINE: the only path to status='submitted'. Throws unless the application is sitting at
// awaiting_confirm with an explicit human approval — this is the App-side half of the plan's
// "double lock" (the executor skill's own protocol is the other half: it must not click Submit
// without first polling this same approval).
export function reportSubmitted(db: DB, jobId: number): void {
  const row = db.prepare("SELECT status, confirm_decision FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string; confirm_decision: string | null }
    | undefined;
  if (!row || row.status !== "awaiting_confirm" || row.confirm_decision !== "approved") {
    throw new Error(
      `reportSubmitted red line: job ${jobId} is not approved+awaiting_confirm ` +
        `(status=${row?.status ?? "none"}, confirm_decision=${row?.confirm_decision ?? "none"})`
    );
  }
  db.prepare("UPDATE applications SET status = 'submitted', submitted_at = datetime('now') WHERE job_id = ?").run(jobId);
}

export interface PendingRow {
  jobId: number;
  company: string;
  title: string;
  direction: string | null;
  score: number | null;
  filledFields: Record<string, string>;
  resumeVersion: string | null;
}

interface PendingRawRow {
  job_id: number;
  company: string;
  title: string;
  direction: string | null;
  score: number | null;
  filled_fields: string | null;
  answer_pack: string | null;
}

// The in-app confirmation queue's data source, and what the executor polls for job-by-job
// status. filled_fields (the reviewable "what got typed where" table) and the resume version
// used are parsed out of their JSON columns here so callers don't need to know the storage shape.
export function pendingConfirmations(db: DB): PendingRow[] {
  const rows = db
    .prepare(
      `SELECT j.id as job_id, j.company, j.title, m.direction, m.score, a.filled_fields, a.answer_pack
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'awaiting_confirm'
       ORDER BY COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC`
    )
    .all() as PendingRawRow[];

  return rows.map((r) => {
    let filledFields: Record<string, string> = {};
    try {
      filledFields = r.filled_fields ? JSON.parse(r.filled_fields) : {};
    } catch {
      filledFields = {};
    }
    let resumeVersion: string | null = null;
    try {
      resumeVersion = r.answer_pack ? JSON.parse(r.answer_pack)?.resume?.version_name ?? null : null;
    } catch {
      resumeVersion = null;
    }
    return {
      jobId: r.job_id,
      company: r.company,
      title: r.title,
      direction: r.direction,
      score: r.score,
      filledFields,
      resumeVersion,
    };
  });
}

export function confirmStatus(db: DB, jobId: number): { decision: string | null; status: string } {
  const row = db.prepare("SELECT status, confirm_decision FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string; confirm_decision: string | null }
    | undefined;
  if (!row) throw new Error(`confirmStatus: no application for job ${jobId}`);
  return { decision: row.confirm_decision, status: row.status };
}
