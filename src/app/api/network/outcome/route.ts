import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordOutcome, Outcome } from "@/network/gate";
import { withUser, failResponse } from "@/lib/actor";

// POST {outreachId, outcome: 'meeting'|'referral_won'|'no_response'} — the /network UI's
// [约到了]/[拿到内推]/[无回应] buttons on a sent/replied outreach thread. recordOutcome itself
// validates the outcome value and the from-status (sent/replied only), and — for referral_won —
// stamps applications.referral_person_id when the outreach is tied to a job.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    recordOutcome(getDb(), userId, Number(body.outreachId), body.outcome as Outcome);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
