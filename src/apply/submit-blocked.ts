import { DB, logEvent } from "@/lib/db";
import { InfoQuestion, infoKind, saveAssistantNote, SUBMIT_BLOCKED_PREFIX } from "@/apply/queue";
import { notifyJobSession } from "@/executor/attended";
import { approvedNotice } from "@/executor/attended-session";
import { maybeAutoStartApply, DecideAutoStartDeps, DecideAutoStartResult } from "@/apply/decide-auto-start";
import { notify } from "@/lib/notify";
import { messages } from "@/i18n/messages";
import type { Lang } from "@/i18n/lang";

// The 「点提交」 card's other half (the parking is queue.ts parkBlockedSubmit): the assistant's
// Submit click was refused by its session's own permission check, the user is told, and the card
// offers 「我提交了」 (the self-submitted route), 「让助手再试一次」 (here) and 「跳过」.

export function submitBlockedCount(db: DB, userId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) n FROM applications WHERE user_id = ? AND status = 'matched' AND needs_manual_reason LIKE ?")
      .get(userId, `${SUBMIT_BLOCKED_PREFIX}%`) as { n: number }
  ).n;
}

export interface RetrySubmitDeps extends DecideAutoStartDeps {
  // Types the approval notice into the terminal of the session that filled the form; true = delivered.
  notifySession?: (line: string, jobId: number) => boolean;
}

export type RetrySubmitResult = { notified: true } | ({ notified: false } & DecideAutoStartResult);

// 「让助手再试一次」: if the session that filled the form is still there, the row goes back to
// approved-and-waiting and that session is told to go back to its tab and click Submit again —
// the same notice an approval sends. (The refusal has not been consistent, so a second try can
// land; if it is refused again the session reports it again and the card comes back.) With no
// session holding the tab, the form is gone with it: the job is handed back as a targeted run that
// fills it afresh, and the fresh fill goes through the approval gate again (auto-apply approves it
// on the spot when the switch is on).
export function retryBlockedSubmit(db: DB, userId: string, jobId: number, note: string | undefined, deps: RetrySubmitDeps = {}): RetrySubmitResult {
  const row = db
    .prepare("SELECT a.status, a.needs_manual_reason, a.pending_questions, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ? AND a.job_id = ?")
    .get(userId, jobId) as { status: string; needs_manual_reason: string | null; pending_questions: string | null; company: string | null } | undefined;
  if (!row) throw new Error(`retryBlockedSubmit: no application for job ${jobId}`);
  let items: InfoQuestion[] = [];
  try {
    items = row.pending_questions ? (JSON.parse(row.pending_questions) as InfoQuestion[]) : [];
  } catch {
    items = [];
  }
  if (row.status !== "matched" || !items.some((q) => infoKind(q) === "submit")) {
    throw new Error(`retryBlockedSubmit: job ${jobId} is not waiting on a Submit click (status=${row.status})`);
  }
  saveAssistantNote(db, userId, jobId, note);
  db.prepare(
    "UPDATE applications SET status = 'awaiting_confirm', confirm_decision = 'approved', needs_manual_reason = NULL, pending_questions = NULL WHERE user_id = ? AND job_id = ?"
  ).run(userId, jobId);
  let notified = false;
  try {
    notified = (deps.notifySession ?? ((line: string, id: number) => notifyJobSession(db, userId, id, line)))(approvedNotice(jobId, row.company ?? ""), jobId);
  } catch {
    notified = false;
  }
  logEvent(db, "application_submit_retry", { userId, entity: "application", entityId: jobId, payload: { notified } });
  if (notified) return { notified: true };
  db.prepare("UPDATE applications SET status = 'matched', confirm_decision = NULL WHERE user_id = ? AND job_id = ?").run(userId, jobId);
  return { ...maybeAutoStartApply(db, userId, { jobIds: [jobId], mode: "direct" }, deps), notified: false };
}

// One push per half hour at most: when every Submit is being refused, a segment produces ten of
// these in twenty minutes, and the user needs to know there is a pile to click through, not ten
// buzzes. The next push after the quiet window says how many are waiting by then.
export const SUBMIT_PUSH_EVERY_MS = 30 * 60_000;
const g = globalThis as unknown as { __sortieSubmitPushAt?: Map<string, number> };
const lastPushAt = (g.__sortieSubmitPushAt ??= new Map<string, number>());

export function resetSubmitPushThrottle(): void {
  lastPushAt.clear();
}

export function notifySubmitBlocked(
  db: DB,
  userId: string,
  jobId: number,
  lang: Lang,
  opts: { now?: number; push?: (title: string, body: string) => void } = {}
): boolean {
  try {
    const now = opts.now ?? Date.now();
    const last = lastPushAt.get(userId);
    if (last != null && now - last < SUBMIT_PUSH_EVERY_MS) return false;
    lastPushAt.set(userId, now);
    const t = messages[lang].notify.submitBlocked;
    const n = submitBlockedCount(db, userId);
    const job = db.prepare("SELECT company, title FROM jobs WHERE id = ?").get(jobId) as { company: string; title: string } | undefined;
    const title = n > 1 ? t.titleMany(n) : t.title(job?.company ?? "?");
    const send = opts.push ?? ((a: string, b: string) => void notify(a, b, { priority: "high", account: { db, userId } }));
    send(title, t.body(job?.title ?? ""));
    return true;
  } catch (e) {
    console.error("[submit-blocked] notify failed for job", jobId, e);
    return false;
  }
}
