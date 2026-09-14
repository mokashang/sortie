import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { executorStatus } from "@/executor/runner";
import { withUser, failResponse } from "@/lib/actor";

// GET — the account's last 10 executor runs (most recent first), with a live log tail attached
// for any still 'running'. executorStatus() reaps stale (dead-pid) 'running' rows to 'failed'
// before listing, so this also self-heals the UI if a run's process died out of band.
export const GET = withUser(async (_req, { userId }) => {
  try {
    return NextResponse.json({ runs: executorStatus(getDb(), userId) });
  } catch (e) {
    return failResponse(e);
  }
});
