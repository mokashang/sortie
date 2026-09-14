import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfileData, saveStandardAnswers } from "@/lib/profile";
import { answerInfo, InfoAnswer } from "@/apply/info";
import { withUser, failResponse } from "@/lib/actor";

// User -> App from /apply's 待补信息 card: {jobId, answers: {key: {value, remember?}}}.
// Remembered answers are merged into the account's standard_answers (so the next application
// gets them in its answer pack without asking); everything is stored on the application and it
// moves on — see answerInfo for the state transitions.
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    const db = getDb();
    const answers = (body.answers ?? {}) as Record<string, InfoAnswer>;
    const result = answerInfo(db, userId, Number(body.jobId), answers, (remembered) => {
      const current = (getProfileData(db, userId)?.standard_answers ?? {}) as Record<string, string>;
      saveStandardAnswers(db, userId, { ...current, ...remembered });
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return failResponse(e);
  }
});
