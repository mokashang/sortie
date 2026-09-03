import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runLogLines } from "@/executor/runner";

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
