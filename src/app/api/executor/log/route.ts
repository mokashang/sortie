import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { getDb } from "@/lib/db";
import { appendRunLog, runLogLines } from "@/executor/runner";

// POST {runId, line} — the attended session's way of reporting a step ("opened Workday tab",
// "filled 6 fields", ...) back to the App. Appended as a timestamped line to the run's log file,
// the same file the headless channel's stdout is redirected to, so the App's status poll's
// logTail works identically for both channels.
// Body via readJsonBody rather than req.json(): inline curl bodies from the session arrive GBK-encoded on Windows (see src/lib/request-body.ts).
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    appendRunLog(getDb(), Number(body.runId), String(body.line ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

// GET /api/executor/log?id=N — the full log of one run, for the App's per-run "详情" view (the
// status poll only carries a 30-line tail, and only for runs still in flight).
export async function GET(req: Request) {
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "missing or invalid 'id'" }, { status: 400 });
    return NextResponse.json({ lines: runLogLines(getDb(), id) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
