import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { stopExecutor } from "@/executor/runner";
import { withUser, failResponse } from "@/lib/actor";

// POST {runId} — stops one of the account's running executor sessions (SIGTERM to its process
// group) and marks the row 'stopped'.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    stopExecutor(getDb(), userId, Number(body.runId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
