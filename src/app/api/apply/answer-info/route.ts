import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfileData, saveStandardAnswers } from "@/lib/profile";
import { answerInfo, InfoAnswer } from "@/apply/info";
import { infoKind, InfoQuestion } from "@/apply/queue";
import { isDocumentPath, userDocumentsDir } from "@/lib/documents";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";
import { withUser, failResponse } from "@/lib/actor";

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
          return NextResponse.json({ error: `文件「${q.label}」还没上传` }, { status: 400 });
        }
      }
    }

    const result = answerInfo(db, userId, jobId, answers, (remembered) => {
      const current = (getProfileData(db, userId)?.standard_answers ?? {}) as Record<string, string>;
      saveStandardAnswers(db, userId, { ...current, ...remembered });
    });
    const started = result.status === "matched" ? maybeAutoStartApply(db, userId, { jobIds: [jobId], mode: "direct" }) : { autoStarted: false };
    return NextResponse.json({ ok: true, ...result, ...started });
  } catch (e) {
    return failResponse(e);
  }
});
