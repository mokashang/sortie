import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enqueueReferralCheck } from "@/apply/referral-check";

// POST — the card's 现在检查 button: enqueue an attended referral_check run (no-op if nothing to
// check or one is already queued/running).
export async function POST() {
  try {
    const runId = enqueueReferralCheck(getDb());
    return NextResponse.json({ ok: true, runId, queued: runId != null });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
