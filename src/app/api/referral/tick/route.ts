import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dueSlot, enqueueReferralChecksForAll } from "@/apply/referral-check";
import { withInternal } from "@/lib/actor";

// Called every 60s by src/instrumentation.ts. Twice a day (09:xx and 18:xx local, once each)
// enqueues a referral_check run for every account with conversations to monitor.
const fired = new Set<string>();

export const POST = withInternal(async () => {
  const key = dueSlot(new Date(), fired);
  if (!key) return NextResponse.json({ due: false });
  fired.add(key);
  const runIds = enqueueReferralChecksForAll(getDb());
  return NextResponse.json({ due: true, slot: key, runIds });
});
