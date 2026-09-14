import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { unpark } from "@/apply/queue";
import { withUser, failResponse } from "@/lib/actor";

// User -> App: clear a parked application's needs_manual_reason so it re-enters the executor's
// pool. Used by the /apply page's needs-manual list "重试" button, typically after the user has
// fixed the underlying problem (e.g. generated the missing-direction resume in Studio).
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    unpark(getDb(), userId, Number(body.jobId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
