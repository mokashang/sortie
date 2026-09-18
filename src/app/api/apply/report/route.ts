import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { getDb } from "@/lib/db";
import { reportFill, reportSubmitted, pausesImmediately, normalizeQuestions, ReportFillInput } from "@/apply/queue";
import { reportNoContact } from "@/apply/referral";
import { needsInfoNotification } from "@/apply/info";
import { getAutoSubmit, autoApproveIfEnabled } from "@/apply/auto-submit";
import { autoAnswerPending } from "@/apply/auto-answer";
import { getBackend } from "@/llm/registry";
import { langFromRequest, messagesFor } from "@/i18n/server";
import { notify } from "@/lib/notify";
import { withUser, failResponse } from "@/lib/actor";

// Executor -> App: status reports during and after a fill attempt.
// body.status === 'submitted' is routed to reportSubmitted (the red-line gate) instead of
// reportFill, since 'submitted' isn't one of reportFill's accepted statuses.
//
// 自动投递 (2026-09-17, src/apply/auto-submit.ts + auto-answer.ts): with the account's switch on,
// an awaiting_confirm report is approved on the spot (response `autoApproved: true` — the
// assistant submits right away instead of waiting), and a needs_info report is first answered by
// the App itself from the candidate's facts (response `autoAnswered: true` + `infoAnswers` — the
// assistant fills them into the tab it still has open). Only what the App could not answer, and
// the items nobody but the user can do (sign in, captcha, a missing file, a manual step), still
// become a 待处理 card.
export const POST = withUser(async (req, { userId }) => {
  const body = await readJsonBody(req);
  try {
    const db = getDb();
    const lang = langFromRequest(req);
    // Referral mode: nobody reachable at this company — jobs stay referral_seeking with the
    // reason shown on the board for the user to decide (直接投 / 微信找 / 放弃).
    if (body.status === "referral_no_contact") {
      const ids = (Array.isArray(body.jobIds) ? body.jobIds : [body.jobId]).map(Number);
      reportNoContact(db, userId, ids, String(body.reason ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.status === "submitted") {
      const jobId = Number(body.jobId);
      reportSubmitted(db, userId, jobId);
      // The user never saw this one go by: tell them it went out.
      if (getAutoSubmit(db, userId)) {
        const job = db.prepare("SELECT company, title FROM jobs WHERE id = ?").get(jobId) as { company: string; title: string } | undefined;
        const t = messagesFor(lang).notify.autoSubmitted;
        void notify(t.title(job?.company ?? "?"), t.body(job?.title ?? ""), { priority: "default" });
      }
      return NextResponse.json({ ok: true });
    }

    reportFill(db, userId, body as ReportFillInput);
    const jobId = Number(body.jobId);
    const autoSubmit = getAutoSubmit(db, userId);

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
      if (autoSubmit && !pausesImmediately(questions)) {
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
      }
      const job = db.prepare("SELECT company, title FROM jobs WHERE id = ?").get(jobId) as { company: string; title: string } | undefined;
      const n = needsInfoNotification(job?.company ?? "?", job?.title ?? "", questions, lang);
      void notify(n.title, n.body, { priority: "high" });
      return NextResponse.json({ ok: true, autoAnswered, remaining: questions.map((q) => q.key) });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
