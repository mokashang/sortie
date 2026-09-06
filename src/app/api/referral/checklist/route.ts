import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { referralChecklist } from "@/network/harvest";

// GET — the referral_check run's work list: every sent/accepted/replied referral outreach.
export async function GET() {
  return NextResponse.json({ checklist: referralChecklist(getDb()) });
}
