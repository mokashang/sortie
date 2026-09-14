import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enqueueReferralCheck } from "@/apply/referral-check";
import { withUser, failResponse } from "@/lib/actor";

// POST — the card's 现在检查 button: enqueue an attended referral_check run (no-op if nothing to
// check or one is already queued/running).
export const POST = withUser(async (_req, { userId }) => {
  try {
    const runId = enqueueReferralCheck(getDb(), userId);
    return NextResponse.json({ ok: true, runId, queued: runId != null });
  } catch (e) {
    return failResponse(e);
  }
});
