import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { archiveManual } from "@/apply/history";

// User -> App from /apply's 需人工清单 "移除"/"移除所选": {jobIds: number[]}. Archives the parked
// rows (reversible via /api/queue/unarchive); rows that aren't parked are reported in `skipped`.
export async function POST(req: Request) {
  const body = await req.json();
  const jobIds = Array.isArray(body.jobIds) ? body.jobIds.map(Number).filter((n: number) => Number.isFinite(n)) : [];
  if (jobIds.length === 0) {
    return NextResponse.json({ error: "jobIds must be a non-empty array" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...archiveManual(getDb(), jobIds) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
