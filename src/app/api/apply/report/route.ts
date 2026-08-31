import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reportFill, reportSubmitted, ReportFillInput } from "@/apply/queue";

// Executor -> App: status reports during and after a fill attempt.
// body.status === 'submitted' is routed to reportSubmitted (the red-line gate) instead of
// reportFill, since 'submitted' isn't one of reportFill's accepted statuses.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    if (body.status === "submitted") {
      reportSubmitted(getDb(), Number(body.jobId));
    } else {
      reportFill(getDb(), body as ReportFillInput);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
