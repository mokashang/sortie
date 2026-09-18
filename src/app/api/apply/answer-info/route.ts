import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfileData, saveStandardAnswers } from "@/lib/profile";
import { answerInfo, InfoAnswer } from "@/apply/info";
import { infoKind, InfoQuestion } from "@/apply/queue";
import { isDocumentPath, userDocumentsDir } from "@/lib/documents";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";
import { askerCanContinue } from "@/apply/followup";
import { notifyAttendedSession } from "@/executor/attended";
import { answeredNotice } from "@/executor/attended-session";
import { withUser, failResponse } from "@/lib/actor";
import { langFromRequest, messagesFor } from "@/i18n/server";

// User -> App from a 待处理 card's form: {jobId, answers: {key: {value, remember?}}}.
// Remembered text answers are merged into the account's standard_answers (so the next
// application gets them in its answer pack without asking); everything is stored on the
// application and it moves on — see answerInfo for the state transitions. A paused row
// (status back to 'matched') is re-queued as a targeted run so the user never has to start
// anything by hand; a waiting row ('prepared') is picked up by the executor still on the form.
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    const db = getDb();
    const jobId = Number(body.jobId);
    const answers = (body.answers ?? {}) as Record<string, InfoAnswer>;

    // A file answer must be a file the upload route wrote into the account's documents folder —
    // never a path typed by hand, which would point the executor's file_upload at an arbitrary file.
    const row = db.prepare("SELECT pending_questions FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
      | { pending_questions: string | null }
      | undefined;
    if (row?.pending_questions) {
      let questions: InfoQuestion[] = [];
      try {
        questions = JSON.parse(row.pending_questions);
      } catch {
        questions = [];
      }
      const dir = userDocumentsDir(db, userId);
      for (const q of questions) {
        if (infoKind(q) !== "file") continue;
        const value = answers[q.key]?.value?.trim();
        if (!value && q.optional) continue;
        if (!value || !isDocumentPath(value, dir)) {
          return NextResponse.json({ error: messagesFor(langFromRequest(req)).errors.fileNotUploaded(q.label) }, { status: 400 });
        }
      }
    }

    // The session that asked keeps the tab open and fills the answers in place — as long as it
    // is still there (its run still running, or the long-lived attended session alive). Otherwise
    // the answer becomes a targeted run below rather than a 'prepared' row handed to nobody.
    const executorWaiting = askerCanContinue(db, userId, jobId);
    const result = answerInfo(
      db,
      userId,
      jobId,
      answers,
      (remembered) => {
        const current = (getProfileData(db, userId)?.standard_answers ?? {}) as Record<string, string>;
        saveStandardAnswers(db, userId, { ...current, ...remembered });
      },
      { executorWaiting }
    );
    if (result.status === "prepared") {
      // A long-lived attended session (attended.ts) is told in its terminal and fills the answers
      // into the tab it kept, whether or not its run is still running; a desktop session sees the
      // 'prepared' status on its next poll (protocol §3.4). False here just means no terminal. If
      // the session never fills it, the dispatcher's reclaim sweep turns it into a targeted run
      // after 30 minutes (src/apply/followup.ts).
      const company = (db.prepare("SELECT company FROM jobs WHERE id = ?").get(jobId) as { company: string | null } | undefined)?.company ?? "";
      let notified = false;
      try {
        notified = notifyAttendedSession(db, answeredNotice(jobId, company));
      } catch {
        notified = false;
      }
      return NextResponse.json({ ok: true, ...result, autoStarted: false, notified });
    }
    const started = maybeAutoStartApply(db, userId, { jobIds: [jobId], mode: "direct" });
    return NextResponse.json({ ok: true, ...result, ...started });
  } catch (e) {
    return failResponse(e);
  }
});
