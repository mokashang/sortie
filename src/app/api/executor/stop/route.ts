import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { stopExecutor } from "@/executor/runner";
import { notifyAttendedSession } from "@/executor/attended";
import { stoppedRunNotice } from "@/executor/attended-session";
import { withUser, failResponse } from "@/lib/actor";

// POST {runId} — stops one of the account's running executor sessions (SIGTERM to its process
// group) and marks the row 'stopped'. A dispatcher-spawned attended session is not killed (it may
// hold other filled tabs); it is told to drop the run through its terminal instead.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    const db = getDb();
    const runId = Number(body.runId);
    stopExecutor(db, userId, runId);
    const notified = notifyAttendedSession(db, stoppedRunNotice(runId));
    return NextResponse.json({ ok: true, notified });
  } catch (e) {
    return failResponse(e);
  }
});
