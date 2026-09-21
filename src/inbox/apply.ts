import type { DB } from "@/lib/db";
import { setStage } from "@/apply/history";
import { isPostSubmitStage, peakOf, isRung, type PostSubmitStage } from "@/apply/stages";
import { messages } from "@/i18n/messages";
import type { Lang } from "@/i18n/lang";
import type { ClassifyResult, MailOutcome } from "@/inbox/classify";
import type { ParsedMail } from "@/inbox/google";
import { insertMailEvent } from "@/inbox/store";

// What a classified mail does to the application (spec 2026-09-21 inbox-sync §2): the stage
// only ever climbs, a rejection lands on anything short of an accepted/declined offer, and
// low-confidence or informational mails are recorded without touching the row. Every change goes
// through setStage, so it is an ordinary 'application_stage' event the user can reverse on 历史.

export const MIN_CONFIDENCE = 0.7;

const RANK: Record<"submitted" | "oa" | "interview" | "offer", number> = { submitted: 0, oa: 1, interview: 2, offer: 3 };

export function decideStage(current: string, outcome: MailOutcome, confidence: number, minConfidence = MIN_CONFIDENCE): PostSubmitStage | null {
  if (confidence < minConfidence) return null;
  if (!isPostSubmitStage(current)) return null;
  if (current === "offer_accepted" || current === "offer_declined") return null;
  if (outcome === "rejected") return current === "rejected" ? null : "rejected";
  if (outcome !== "oa" && outcome !== "interview" && outcome !== "offer") return null;
  // News of a next step after the user marked the row rejected is contradictory (most often a
  // mail about a sibling requisition); leave it for the user. A 'stale' row simply woke up.
  if (current === "rejected") return null;
  if (current === "stale") return outcome;
  if (!isRung(current)) return null;
  return RANK[outcome] > RANK[peakOf(current)] ? outcome : null;
}

export interface AppliedMail {
  eventId: number;
  jobId: number | null;
  company: string | null;
  title: string | null;
  outcome: MailOutcome;
  applied: boolean;
  stageFrom: string | null;
  stageTo: string | null;
  summary: string;
  nextStep: string | null;
  notify: boolean; // the caller should push a notification for this one
}

function utcOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

// Records the mail and, when the rules say so, moves the application. The job the model named
// must be one of this user's submitted applications — anything else is filed as unmatched.
export function applyMailResult(db: DB, userId: string, mail: ParsedMail, result: ClassifyResult): AppliedMail {
  let jobId: number | null = null;
  let company: string | null = null;
  let title: string | null = null;
  let status: string | null = null;
  if (result.job_id != null) {
    const row = db
      .prepare("SELECT a.status, j.company, j.title FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ? AND a.job_id = ?")
      .get(userId, result.job_id) as { status: string; company: string; title: string } | undefined;
    if (row && isPostSubmitStage(row.status)) {
      jobId = result.job_id;
      company = row.company;
      title = row.title;
      status = row.status;
    }
  }
  const outcome: MailOutcome = jobId == null && result.outcome !== "unrelated" ? (result.outcome === "other" || result.outcome === "received" ? "unrelated" : result.outcome) : result.outcome;
  const target = jobId != null && status ? decideStage(status, outcome, result.confidence) : null;
  const summary = result.summary.trim();
  const nextStep = result.next_step?.trim() || null;

  const eventId = db.transaction(() => {
    if (target && jobId != null) {
      const note = [summary, mail.subject ? `[${mail.subject.slice(0, 120)}]` : ""].filter(Boolean).join(" ");
      setStage(db, userId, jobId, target, note || null);
    }
    return insertMailEvent(db, {
      userId,
      messageId: mail.id,
      threadId: mail.threadId,
      receivedAt: utcOf(mail.receivedAtMs),
      from: mail.from,
      subject: mail.subject,
      snippet: mail.snippet,
      jobId,
      outcome,
      confidence: result.confidence,
      summary,
      nextStep,
      applied: target != null,
      stageFrom: target ? status : null,
      stageTo: target,
    });
  })();

  const actionable = jobId != null && (outcome === "oa" || outcome === "interview" || outcome === "offer");
  return {
    eventId,
    jobId,
    company,
    title,
    outcome,
    applied: target != null,
    stageFrom: target ? status : null,
    stageTo: target,
    summary,
    nextStep,
    notify: target != null || (actionable && result.confidence >= MIN_CONFIDENCE),
  };
}

// The push for one mail that changed something (or carries a next step): company + what
// happened in the title, the model's one-liner and the next step in the body.
export function inboxNotification(lang: Lang, a: AppliedMail): { title: string; body: string } {
  const t = messages[lang].notify.inbox;
  const stage = a.stageTo && isPostSubmitStage(a.stageTo) ? messages[lang].stages.stage[a.stageTo] : null;
  const company = a.company ?? "";
  const title = a.applied && stage ? t.changed(company, stage) : t.news(company, t.outcome[a.outcome]);
  const body = t.body(a.title ?? "", a.summary, a.nextStep);
  return { title, body };
}
