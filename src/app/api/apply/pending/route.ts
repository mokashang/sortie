import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingConfirmations, confirmStatus } from "@/apply/queue";
import { pendingInfo } from "@/apply/info";
import { withUser, failResponse } from "@/lib/actor";

// No params: the in-app confirmation queue's data source. ?jobId=: single-job status poll,
// used by the executor while it waits (up to 30min) for a human to approve/reject its fill.
export const GET = withUser(async (req, { userId }) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  try {
    const db = getDb();
    if (jobId) {
      return NextResponse.json(confirmStatus(db, userId, Number(jobId)));
    }
    // needsInfo: the 待补信息 cards (executor waiting on the user, or timed out with questions kept).
    return NextResponse.json({ pending: pendingConfirmations(db, userId), needsInfo: pendingInfo(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
