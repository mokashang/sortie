import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { takeNextApplication } from "@/apply/queue";
import { takeNextReferral } from "@/apply/referral";
import { documentsMap, userDocumentsDir } from "@/lib/documents";
import { withUser, failResponse } from "@/lib/actor";

// Executor -> App: "give me the next task". {mode:'referral'} returns a ReferralTask (a company
// + up to 3 jobs to seek a referral for); anything else returns an ApplyTask for a direct fill.
// {jobIds} scopes either picker to specific jobs (the board's 直接投 / 有内推 / 换人 runs).
// All picking/locking/parking logic lives in src/apply/queue.ts and src/apply/referral.ts.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json().catch(() => ({}));
    const direction = typeof body?.direction === "string" ? body.direction : undefined;
    const jobIds = Array.isArray(body?.jobIds)
      ? (body.jobIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : undefined;
    const db = getDb();
    if (body?.mode === "referral") {
      return NextResponse.json(takeNextReferral(db, userId, { direction, jobIds }));
    }
    return NextResponse.json(takeNextApplication(db, userId, loadProfile(db, userId), { direction, jobIds, documents: documentsMap(userDocumentsDir(db, userId)) }));
  } catch (e) {
    return failResponse(e);
  }
});
