import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dueSlot, enqueueReferralCheck } from "@/apply/referral-check";

// Called every 60s by src/instrumentation.ts. Twice a day (09:xx and 18:xx local, once each)
// enqueues a referral_check run when there are conversations to monitor.
const fired = new Set<string>();

export async function POST() {
  const key = dueSlot(new Date(), fired);
  if (!key) return NextResponse.json({ due: false });
  fired.add(key);
  const runId = enqueueReferralCheck(getDb());
  return NextResponse.json({ due: true, slot: key, runId });
}
