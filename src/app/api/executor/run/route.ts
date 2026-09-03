import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/executor/run?id=N — a single run row, for the attended session's poll loop to check
// (mainly: has the App-side user clicked 停止, flipping this to 'stopped', so the loop should
// stop driving the browser and exit). Deliberately doesn't call reapStaleRuns/executorStatus's
// heavier last-10 listing — this is a lightweight single-row lookup, polled frequently.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "missing or invalid 'id'" }, { status: 400 });
    }
    const row = getDb()
      .prepare(
        "SELECT id, kind, status, channel, pid, log_path, options, summary, started_at, claimed_at, ended_at FROM executor_runs WHERE id=?"
      )
      .get(id) as
      | {
          id: number;
          kind: string;
          status: string;
          channel: string;
          pid: number | null;
          log_path: string | null;
          options: string;
          summary: string | null;
          started_at: string;
          claimed_at: string | null;
          ended_at: string | null;
        }
      | undefined;
    if (!row) {
      return NextResponse.json({ error: `no run #${id}` }, { status: 404 });
    }
    let options: unknown = {};
    try {
      options = JSON.parse(row.options);
    } catch {
      options = {};
    }
    return NextResponse.json({
      run: {
        id: row.id,
        kind: row.kind,
        status: row.status,
        channel: row.channel,
        pid: row.pid,
        logPath: row.log_path,
        options,
        summary: row.summary,
        startedAt: row.started_at,
        claimedAt: row.claimed_at,
        endedAt: row.ended_at,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
