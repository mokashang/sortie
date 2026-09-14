import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { takeNextApplication } from "@/apply/queue";
import { takeNextReferral } from "@/apply/referral";
import { documentsMap } from "@/lib/documents";

// Executor -> App: "give me the next task". {mode:'referral'} returns a ReferralTask (a company
// + up to 3 jobs to seek a referral for); anything else returns an ApplyTask for a direct fill.
// {jobIds} scopes either picker to specific jobs (the board's 直接投 / 有内推 / 换人 runs).
// All picking/locking/parking logic lives in src/apply/queue.ts and src/apply/referral.ts.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const direction = typeof body?.direction === "string" ? body.direction : undefined;
    const jobIds = Array.isArray(body?.jobIds)
      ? (body.jobIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : undefined;
    if (body?.mode === "referral") {
      return NextResponse.json(takeNextReferral(getDb(), { direction, jobIds }));
    }
    return NextResponse.json(takeNextApplication(getDb(), loadProfile(), { direction, jobIds, documents: documentsMap() }));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
