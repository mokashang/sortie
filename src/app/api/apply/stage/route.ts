import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setStage } from "@/apply/history";
import { withUser, failResponse } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// User -> App from /history's per-row status selector: {jobId, stage, note?}. Only post-submit
// applications may move, and only between post-submit stages — see setStage.
export const POST = withUser(async (req, { userId }) => {
  const body = await readJsonBody(req);
  try {
    setStage(getDb(), userId, Number(body.jobId), String(body.stage ?? ""), body.note ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
