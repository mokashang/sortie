import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { finishRun } from "@/executor/runner";

// POST {runId, status: 'done'|'failed'|'stopped', summary?} — the attended session calls this
// when it's done driving the browser for a run (or the user interrupted it). Only valid from
// 'running'/'queued'; see src/executor/runner.ts's finishRun for the full transition rules.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const status = body.status as string;
    if (status !== "done" && status !== "failed" && status !== "stopped") {
      return NextResponse.json({ error: `invalid status '${status}'` }, { status: 400 });
    }
    finishRun(getDb(), Number(body.runId), status, body.summary ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
