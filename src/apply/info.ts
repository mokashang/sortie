import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { DB, logEvent } from "@/lib/db";
import { InfoQuestion } from "@/apply/queue";

// The 待补信息 ("needs info") flow: mid-fill, the executor hits a required question the answer
// pack can't answer. Instead of parking the job for a human it reports needs_info with the
// questions (reportFill in queue.ts), the App pushes a desktop/ntfy notification, the user
// answers on /apply, and the executor — still on the form, polling confirmStatus — continues.
// Everything the user answers can be remembered into profile.standard_answers so the same
// question is never asked twice; "仅本次" answers stay on this application only (info_answers).

export interface InfoAnswer {
  value: string;
  remember?: boolean; // default true — persist to profile.standard_answers under the question key
}

export interface PendingInfoRow {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  status: string; // 'needs_info' (executor waiting) | 'matched' (executor timed out; parked with reason)
  needsManualReason: string | null;
  questions: InfoQuestion[];
  askedAt: string; // local "MM-DD HH:MM"
}

interface PendingInfoRaw {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  direction: string | null;
  status: string;
  needs_manual_reason: string | null;
  pending_questions: string;
  asked_at: string;
}

// /apply's 待补信息 panel: every application with open questions — the executor is either still
// waiting on it (needs_info) or gave up after the timeout and parked it (matched + reason), in
// which case answering re-queues it and the next run continues with the answers.
export function pendingInfo(db: DB): PendingInfoRow[] {
  const rows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, j.apply_url, m.direction, a.status, a.needs_manual_reason,
              a.pending_questions, strftime('%m-%d %H:%M', a.updated_at, 'localtime') as asked_at
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id
       WHERE a.pending_questions IS NOT NULL
         AND (a.status = 'needs_info' OR (a.status = 'matched' AND a.needs_manual_reason IS NOT NULL))
       ORDER BY (a.status = 'needs_info') DESC, a.updated_at DESC`
    )
    .all() as PendingInfoRaw[];
  return rows.flatMap((r) => {
    let questions: InfoQuestion[] = [];
    try {
      questions = JSON.parse(r.pending_questions);
    } catch {
      return [];
    }
    return [
      {
        jobId: r.job_id,
        company: r.company,
        title: r.title,
        applyUrl: r.apply_url,
        direction: r.direction,
        status: r.status,
        needsManualReason: r.needs_manual_reason,
        questions,
        askedAt: r.asked_at,
      },
    ];
  });
}

export interface AnswerInfoResult {
  remembered: Record<string, string>; // what got persisted to profile.standard_answers
  status: string; // the application's status after answering
}

// User -> App from the 待补信息 card. Stores the answers on the application (all of them, so the
// executor / a later re-take sees the full set), hands the remembered ones to `persist` (the
// profile writer, injected so tests don't touch profile.yaml), and moves the application on:
// needs_info -> prepared (the waiting executor's next poll picks the answers up and continues);
// matched+parked -> matched unparked (re-enters the queue; the next run's answer pack carries
// the answers). Every question must be answered — a half-answered form would just bounce back.
export function answerInfo(
  db: DB,
  jobId: number,
  answers: Record<string, InfoAnswer>,
  persist: (remembered: Record<string, string>) => void
): AnswerInfoResult {
  const row = db
    .prepare("SELECT status, pending_questions, info_answers, needs_manual_reason FROM applications WHERE job_id = ?")
    .get(jobId) as
    | { status: string; pending_questions: string | null; info_answers: string | null; needs_manual_reason: string | null }
    | undefined;
  if (!row) throw new Error(`answerInfo: no application for job ${jobId}`);
  if (!row.pending_questions) throw new Error(`answerInfo: job ${jobId} has no pending questions`);
  if (row.status !== "needs_info" && row.status !== "matched") {
    throw new Error(`answerInfo: cannot answer from status '${row.status}' (must be 'needs_info' or 'matched')`);
  }
  let questions: InfoQuestion[] = [];
  try {
    questions = JSON.parse(row.pending_questions);
  } catch {
    throw new Error(`answerInfo: job ${jobId} has corrupt pending_questions`);
  }

  const all: Record<string, string> = {};
  const remembered: Record<string, string> = {};
  for (const q of questions) {
    const a = answers[q.key];
    const value = typeof a?.value === "string" ? a.value.trim() : "";
    if (!value) {
      if (q.optional) continue; // left blank on purpose — the executor skips this field
      throw new Error(`answerInfo: missing answer for '${q.key}'`);
    }
    if (q.options && q.options.length > 0 && !q.options.includes(value)) {
      throw new Error(`answerInfo: '${value}' is not one of the options for '${q.key}'`);
    }
    all[q.key] = value;
    if (a.remember !== false) remembered[q.key] = value;
  }

  let existing: Record<string, string> = {};
  try {
    existing = row.info_answers ? JSON.parse(row.info_answers) : {};
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...all };

  if (Object.keys(remembered).length > 0) persist(remembered);

  const nextStatus = row.status === "needs_info" ? "prepared" : "matched";
  db.prepare(
    "UPDATE applications SET status = ?, info_answers = ?, pending_questions = NULL, needs_manual_reason = NULL WHERE job_id = ?"
  ).run(nextStatus, JSON.stringify(merged), jobId);
  logEvent(db, "application_info_answered", {
    entity: "application",
    entityId: jobId,
    payload: { keys: Object.keys(all), remembered: Object.keys(remembered), from: row.status, to: nextStatus },
  });
  return { remembered, status: nextStatus };
}

// The notification the App pushes when the executor reports needs_info — one line the user can
// act on from the lock screen: which company, how many questions, where to go.
export function needsInfoNotification(company: string, title: string, questions: InfoQuestion[], lang: Lang): { title: string; body: string } {
  const labels = questions.map((q) => q.label).join(" / ");
  const t = messages[lang].notify.needsInfo;
  return { title: t.title(company, questions.length), body: t.body(title, labels.slice(0, 160)) };
}
