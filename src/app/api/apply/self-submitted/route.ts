import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordExternalSubmission } from "@/apply/history";
import { withUser, failResponse } from "@/lib/actor";
import { langFromRequest, messagesFor } from "@/i18n/server";

// User -> App from a 待处理 card's 「我自己投完了」: {jobId}. The user finished the form by hand,
// so the application moves into the post-submit lifecycle (dated now) and shows on /history.
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    recordExternalSubmission(getDb(), userId, Number(body.jobId), messagesFor(langFromRequest(req)).errors.selfSubmittedNote);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
