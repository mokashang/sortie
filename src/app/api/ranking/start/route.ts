import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { RankingBusyError, startRankedFrom, startRankedPicked } from "@/apply/ranking";
import { withUser, failResponse } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// From the 天梯 tab: {fromRank} works the list from that company down, as a relay of segments;
// {jobIds} queues the picked jobs next. 暂停 is the ordinary /api/executor/stop on the list's task.
export const POST = withUser(async (req, { userId }) => {
  const body = await readJsonBody(req);
  try {
    const db = getDb();
    if (Array.isArray(body.jobIds)) {
      const ids = (body.jobIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length === 0) return NextResponse.json({ error: "jobIds is empty", code: "bad_request" }, { status: 400 });
      return NextResponse.json({ ok: true, ...startRankedPicked(db, userId, ids) });
    }
    const fromRank = Number(body.fromRank);
    if (!Number.isInteger(fromRank) || fromRank <= 0) return NextResponse.json({ error: "fromRank must be a positive integer", code: "bad_request" }, { status: 400 });
    return NextResponse.json({ ok: true, ...startRankedFrom(db, userId, fromRank) });
  } catch (e) {
    if (e instanceof RankingBusyError) return NextResponse.json({ error: e.message, code: "ranking_running", runId: e.runId }, { status: 409 });
    return failResponse(e);
  }
});
