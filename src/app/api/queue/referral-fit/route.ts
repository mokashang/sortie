import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { runReferralFit, countUnclassified } from "@/matcher/referral-fit";

let inFlight = false;

// /queue's 补判内推建议 button. POST classifies every still-unclassified queued job in the
// background (~80 fast-tier calls for a 3200-row queue); GET reports how many remain and whether
// a pass is running so the button can poll until it's done.
export async function GET() {
  return NextResponse.json({ unclassified: countUnclassified(getDb()), running: inFlight });
}

export async function POST() {
  const db = getDb();
  const unclassified = countUnclassified(db);
  if (inFlight || unclassified === 0) return NextResponse.json({ started: false, unclassified });
  inFlight = true;
  void (async () => {
    try {
      for (let pass = 0; pass < 20; pass++) {
        const s = await runReferralFit(db, { backend: getBackend(), batchSize: 40, concurrency: 4 });
        if (s.classified === 0) break;
      }
    } catch (e) {
      console.error("[referral-fit]", e);
    } finally {
      inFlight = false;
    }
  })();
  return NextResponse.json({ started: true, unclassified });
}
