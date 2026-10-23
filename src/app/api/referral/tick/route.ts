import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dueSlot, enqueueReferralChecksForAll } from "@/apply/referral-check";
import { resolveReferralsForAll } from "@/apply/referral-auto";
import { withInternal } from "@/lib/actor";

// Called every 60s by src/instrumentation.ts. Three times a day (09:xx, 13:xx and 18:xx local, once each)
// enqueues a referral_check run for every account with conversations to monitor. Every ten
// minutes, settles the companies whose referral hunt is over by the clock (14 days for an
// invite, 30 overall — src/apply/referral-policy.ts) and queues their applications.
const fired = new Set<string>();
const RESOLVE_EVERY_MS = 10 * 60_000;
let lastResolve = 0;

export const POST = withInternal(async () => {
  const db = getDb();
  let resolved: unknown[] = [];
  if (Date.now() - lastResolve >= RESOLVE_EVERY_MS) {
    lastResolve = Date.now();
    resolved = resolveReferralsForAll(db);
  }
  const key = dueSlot(new Date(), fired);
  if (!key) return NextResponse.json({ due: false, resolved });
  const runIds = enqueueReferralChecksForAll(db);
  // Marked only once the checks are queued: a throw above retries next minute instead of losing
  // the slot for the day.
  fired.add(key);
  return NextResponse.json({ due: true, slot: key, runIds, resolved });
});
