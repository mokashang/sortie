import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { unpark } from "@/apply/queue";

// User -> App: clear a parked application's needs_manual_reason so it re-enters the executor's
// pool. Used by the /apply page's needs-manual list "重试" button, typically after the user has
// fixed the underlying problem (e.g. generated the missing-direction resume in Studio).
export async function POST(req: Request) {
  const body = await req.json();
  try {
    unpark(getDb(), Number(body.jobId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
