import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingConfirmations, confirmStatus } from "@/apply/queue";
import { pendingInfo } from "@/apply/info";
import { sessionOfCaller } from "@/executor/sessions";
import { heldByOtherSession } from "@/executor/attended";
import { langFromRequest } from "@/i18n/server";
import { withUser, failResponse } from "@/lib/actor";

// No params: the in-app confirmation queue's data source. ?jobId=: single-job status poll,
// used by the executor while it waits (up to 30min) for a human to approve/reject its fill.
//
// A dispatcher-spawned session asking (its resume phase looks for approvals to submit) only sees
// the filled forms that are its own or that no reachable session holds any more: with tasks
// running side by side (2026-09-30), another session's approved form is in that session's tab,
// that session has been told, and a second one refilling it would only make the user confirm
// twice — or submit it twice.
export const GET = withUser(async (req, actor) => {
  const userId = actor.userId;
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  try {
    const db = getDb();
    if (jobId) {
      return NextResponse.json(confirmStatus(db, userId, Number(jobId)));
    }
    let pending = pendingConfirmations(db, userId);
    const caller = sessionOfCaller(db, actor);
    if (caller) pending = pending.filter((p) => !heldByOtherSession(db, userId, p.jobId, caller));
    // needsInfo: the 待处理 cards (executor waiting on the user, or paused with its to-do items kept).
    return NextResponse.json({ pending, needsInfo: pendingInfo(db, userId, langFromRequest(req)) });
  } catch (e) {
    return failResponse(e);
  }
});
