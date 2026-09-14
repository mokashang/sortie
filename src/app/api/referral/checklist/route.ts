import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { referralChecklist } from "@/network/harvest";
import { withUser } from "@/lib/actor";

// GET — the referral_check run's work list: every sent/accepted/replied referral outreach.
export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json({ checklist: referralChecklist(getDb(), userId) });
});
