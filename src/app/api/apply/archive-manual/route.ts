import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { archiveManual } from "@/apply/history";
import { withUser, failResponse } from "@/lib/actor";

// User -> App from a 待处理 card's 「跳过这个岗」 (or a batch remove): {jobIds: number[]}. Archives the paused / waiting
// rows (reversible via /api/queue/unarchive); rows that aren't parked are reported in `skipped`.
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  const jobIds = Array.isArray(body.jobIds) ? body.jobIds.map(Number).filter((n: number) => Number.isFinite(n)) : [];
  if (jobIds.length === 0) {
    return NextResponse.json({ error: "jobIds must be a non-empty array" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...archiveManual(getDb(), userId, jobIds) });
  } catch (e) {
    return failResponse(e);
  }
});
