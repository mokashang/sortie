import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingConfirmations, confirmStatus } from "@/apply/queue";
import { pendingInfo } from "@/apply/info";

// No params: the in-app confirmation queue's data source. ?jobId=: single-job status poll,
// used by the executor while it waits (up to 30min) for a human to approve/reject its fill.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  try {
    if (jobId) {
      return NextResponse.json(confirmStatus(getDb(), Number(jobId)));
    }
    // needsInfo: the 待处理 cards (executor waiting on the user, or paused with its to-do items kept).
    return NextResponse.json({ pending: pendingConfirmations(getDb()), needsInfo: pendingInfo(getDb()) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
