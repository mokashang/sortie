import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadProfile, saveStandardAnswers } from "@/lib/profile";
import { answerInfo, InfoAnswer } from "@/apply/info";

// User -> App from /apply's 待补信息 card: {jobId, answers: {key: {value, remember?}}}.
// Remembered answers are merged into profile.yaml's standard_answers (so the next application
// gets them in its answer pack without asking); everything is stored on the application and it
// moves on — see answerInfo for the state transitions.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    const answers = (body.answers ?? {}) as Record<string, InfoAnswer>;
    const result = answerInfo(getDb(), Number(body.jobId), answers, (remembered) => {
      saveStandardAnswers({ ...loadProfile().standard_answers, ...remembered });
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
