import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingConfirmations, confirmStatus } from "@/apply/queue";

// No params: the in-app confirmation queue's data source. ?jobId=: single-job status poll,
// used by the executor while it waits (up to 30min) for a human to approve/reject its fill.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  try {
    if (jobId) {
      return NextResponse.json(confirmStatus(getDb(), Number(jobId)));
    }
    return NextResponse.json({ pending: pendingConfirmations(getDb()) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
