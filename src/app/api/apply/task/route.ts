import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApplyTask } from "@/apply/queue";
import { withUser } from "@/lib/actor";

// Executor -> App, resume mode only: re-fetch a prepared/awaiting_confirm application's task
// shape (applyUrl + answerPack, including the resume pdf_path) without taking a new job off the
// queue. Used by buildApplyPrompt's resume section to re-open and re-fill an application a prior
// executor process left approved+awaiting_confirm but never got to submit.
export const GET = withUser(async (req, { userId }) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  }
  const result = getApplyTask(getDb(), userId, Number(jobId));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
});
