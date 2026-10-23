import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJsonBody } from "@/lib/request-body";
import { retryBlockedSubmit } from "@/apply/submit-blocked";
import { withUser, failResponse } from "@/lib/actor";

// User -> App from a 「点提交」 card's 「让助手再试一次」: {jobId, note?}. The session holding the
// filled tab is told to click Submit again; with no such session the job is filled afresh by a
// targeted run (src/apply/submit-blocked.ts). Answers {notified} or the queued run.
export const POST = withUser(async (req, { userId }) => {
  const body = await readJsonBody(req);
  try {
    const jobId = Number(body.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "jobId must be a positive integer", code: "bad_request" }, { status: 400 });
    const result = retryBlockedSubmit(getDb(), userId, jobId, typeof body.note === "string" ? body.note : undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return failResponse(e);
  }
});
