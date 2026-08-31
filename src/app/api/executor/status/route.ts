import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { executorStatus } from "@/executor/runner";

// GET — the last 10 executor runs (most recent first), with a live log tail attached for any
// still 'running'. executorStatus() reaps stale (dead-pid) 'running' rows to 'failed' before
// listing, so this also self-heals the UI if a run's process died out of band.
export async function GET() {
  try {
    return NextResponse.json({ runs: executorStatus(getDb()) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
