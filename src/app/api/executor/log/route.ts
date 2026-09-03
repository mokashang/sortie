import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appendRunLog } from "@/executor/runner";

// POST {runId, line} — the attended session's way of reporting a step ("opened Workday tab",
// "filled 6 fields", ...) back to the App. Appended as a timestamped line to the run's log file,
// the same file the headless channel's stdout is redirected to, so the App's status poll's
// logTail works identically for both channels.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    appendRunLog(getDb(), Number(body.runId), String(body.line ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
