import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { runReferralFit, countUnclassified } from "@/matcher/referral-fit";
import { withUser } from "@/lib/actor";

// One pass in flight per account.
const inFlight = new Set<string>();

// /queue's 补判内推建议 button. POST classifies every still-unclassified queued job in the
// background (~80 fast-tier calls for a 3200-row queue); GET reports how many remain and whether
// a pass is running so the button can poll until it's done.
export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json({ unclassified: countUnclassified(getDb(), userId), running: inFlight.has(userId) });
});

export const POST = withUser(async (_req, { userId }) => {
  const db = getDb();
  const unclassified = countUnclassified(db, userId);
  if (inFlight.has(userId) || unclassified === 0) return NextResponse.json({ started: false, unclassified });
  inFlight.add(userId);
  void (async () => {
    try {
      for (let pass = 0; pass < 20; pass++) {
        const s = await runReferralFit(db, { userId, backend: getBackend(), batchSize: 40, concurrency: 4 });
        if (s.classified === 0) break;
      }
    } catch (e) {
      console.error("[referral-fit]", e);
    } finally {
      inFlight.delete(userId);
    }
  })();
  return NextResponse.json({ started: true, unclassified });
});
