import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRun } from "@/executor/runner";
import { withUser, failResponse } from "@/lib/actor";

// GET /api/executor/run?id=N — a single run row, for the attended session's poll loop to check
// (mainly: has the App-side user clicked 停止, flipping this to 'stopped', so the loop should
// stop driving the browser and exit). Deliberately doesn't call reapStaleRuns/executorStatus's
// heavier last-10 listing — this is a lightweight single-row lookup, polled frequently.
export const GET = withUser(async (req, { userId }) => {
  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "missing or invalid 'id'" }, { status: 400 });
    }
    const run = getRun(getDb(), userId, id);
    if (!run) {
      return NextResponse.json({ error: `no run #${id}` }, { status: 404 });
    }
    return NextResponse.json({ run });
  } catch (e) {
    return failResponse(e);
  }
});
