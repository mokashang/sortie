import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { getDb } from "@/lib/db";
import { reportFill, reportSubmitted, pausesImmediately, normalizeQuestions, infoKind, ReportFillInput } from "@/apply/queue";
import { reportNoContact } from "@/apply/referral";
import { resolveReferrals, afterReferralSubmitted } from "@/apply/referral-auto";
import { needsInfoNotification } from "@/apply/info";
import { getAutoSubmit, autoApproveIfEnabled } from "@/apply/auto-submit";
import { autoAnswerPending } from "@/apply/auto-answer";
import { getBackend } from "@/llm/registry";
import { langFromRequest, messagesFor } from "@/i18n/server";
import { notify } from "@/lib/notify";
import { withUser, failResponse } from "@/lib/actor";
import { notifySubmitBlocked } from "@/apply/submit-blocked";

const REPORT_STATUSES = new Set<string>(["awaiting_confirm", "needs_info", "needs_manual", "error", "closed", "already_applied", "submit_blocked"]);

// Executor -> App: status reports during and after a fill attempt.
// body.status === 'submitted' is routed to reportSubmitted (the red-line gate) instead of
// reportFill, since 'submitted' isn't one of reportFill's accepted statuses.
//
// 自动投递 (2026-09-17, src/apply/auto-submit.ts): with the account's switch on, an
// awaiting_confirm report is approved on the spot (response `autoApproved: true` — the assistant
// submits right away instead of waiting). Independently of the switch (since 2026-09-24,
// src/apply/auto-answer.ts), a needs_info report is first answered by the App itself from the
// candidate's facts (response `autoAnswered: true` + `infoAnswers` — the assistant fills them into
// the tab it still has open). Only what the App could not answer, and the items nobody but the
// user can do (sign in, captcha, a missing file, a manual step), still become a 待处理 card.
//
// submit_blocked (2026-10-22): the session's own permission check refused the Submit click on an
// approved fill. The row becomes a 「点提交」 card (queue.ts parkBlockedSubmit) and the user gets a
// push — at most one per half hour (src/apply/submit-blocked.ts); the session moves on.
export const POST = withUser(async (req, actor) => {
  const { userId } = actor;
  const body = await readJsonBody(req);
  try {
    const db = getDb();
    const lang = langFromRequest(req);
    // Referral mode: nobody reachable at this company — the reason goes on the board card and
    // the App applies directly (src/apply/referral-auto.ts).
    if (body.status === "referral_no_contact") {
      const ids = (Array.isArray(body.jobIds) ? body.jobIds : [body.jobId]).map(Number);
      reportNoContact(db, userId, ids, String(body.reason ?? ""));
      const resolved = resolveReferrals(db, userId);
      return NextResponse.json({ ok: true, resolved });
    }
    if (body.status === "submitted") {
      const jobId = Number(body.jobId);
      reportSubmitted(db, userId, jobId);
      // Went in with a referral: the referrer hears about it from the next conversation check.
      afterReferralSubmitted(db, userId, jobId);
      // The user never saw this one go by: tell them it went out.
      if (getAutoSubmit(db, userId)) {
        const job = db.prepare("SELECT company, title FROM jobs WHERE id = ?").get(jobId) as { company: string; title: string } | undefined;
        const t = messagesFor(lang).notify.autoSubmitted;
        void notify(t.title(job?.company ?? "?"), t.body(job?.title ?? ""), { priority: "default", account: { db, userId } });
      }
      return NextResponse.json({ ok: true });
    }

    // Refuse what the protocol doesn't have instead of guessing: an unknown status used to fall
    // through to the catch-all and park a finished form as 「助手没能完成这份申请」, and a flag sent
    // as the string "false" was truthy (archived the job / muted its whole board).
    if (!REPORT_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `unknown status '${String(body.status)}' (one of ${[...REPORT_STATUSES, "submitted", "referral_no_contact"].join(", ")})`, code: "bad_request" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(Number(body.jobId)) || Number(body.jobId) <= 0) {
      return NextResponse.json({ error: "jobId must be a positive integer", code: "bad_request" }, { status: 400 });
    }
    const flag = (v: unknown) => v === true || v === "true" || v === 1;
    reportFill(db, userId, { ...body, jobId: Number(body.jobId), archive: flag(body.archive), boardGone: flag(body.boardGone) } as ReportFillInput, {
      shared: actor.user?.role === "owner",
    });
    const jobId = Number(body.jobId);
    const autoSubmit = getAutoSubmit(db, userId);

    if (body.status === "submit_blocked") {
      notifySubmitBlocked(db, userId, jobId, lang);
      return NextResponse.json({ ok: true, card: "submit" });
    }

    if (body.status === "awaiting_confirm" && autoSubmit) {
      const autoApproved = autoApproveIfEnabled(db, userId, jobId);
      return NextResponse.json({ ok: true, autoApproved });
    }

    // needs_info: the executor is parked on the form waiting for the user — push a desktop
    // (osascript) + ntfy notification so they come to /apply and answer. Fire-and-forget: a
    // notification hiccup must never fail the report itself.
    if (body.status === "needs_info") {
      let questions = normalizeQuestions(body.questions);
      let autoAnswered: boolean | "partial" = false;
      let infoAnswers: Record<string, string> | undefined;
      // Text questions are answered from the user's own facts whether or not 自动投递 is on
      // (2026-09-24, user request: a card only for what the App truly can't answer). With the
      // switch off the answers still land on the 待确认 card for review before anything is sent.
      if (!pausesImmediately(questions)) {
        const r = await autoAnswerPending(db, userId, jobId, { backend: getBackend() });
        if (r.status === "prepared") {
          autoAnswered = true;
          const row = db.prepare("SELECT info_answers FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
            | { info_answers: string | null }
            | undefined;
          try {
            infoAnswers = row?.info_answers ? (JSON.parse(row.info_answers) as Record<string, string>) : r.answered;
          } catch {
            infoAnswers = r.answered;
          }
          return NextResponse.json({ ok: true, autoAnswered, infoAnswers });
        }
        if (Object.keys(r.answered).length > 0) autoAnswered = "partial";
        questions = r.remaining.length > 0 ? r.remaining : questions;
      } else if (questions.some((q) => infoKind(q) === "text")) {
        // A login / manual card the assistant hung a question on (would you move to Houston?):
        // the App answers it now, so the card only says what the user really has to do and the
        // answer is on the row when the job comes back after the login (2026-10-06: Gunvor and
        // NISA sat on 「愿意搬去 …?」 after the user had logged in).
        const r = await autoAnswerPending(db, userId, jobId, { backend: getBackend() });
        questions = r.remaining.length > 0 ? r.remaining : questions;
      }
      const job = db.prepare("SELECT company, title FROM jobs WHERE id = ?").get(jobId) as { company: string; title: string } | undefined;
      const n = needsInfoNotification(job?.company ?? "?", job?.title ?? "", questions, lang);
      void notify(n.title, n.body, { priority: "high", account: { db, userId } });
      return NextResponse.json({ ok: true, autoAnswered, remaining: questions.map((q) => q.key) });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
