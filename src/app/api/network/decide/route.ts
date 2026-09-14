import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { rejectOutreach, unapproveOutreach } from "@/network/gate";
import { approveOutreachAndMaybeAutoStart } from "@/apply/referral-glue";
import { withUser, failResponse } from "@/lib/actor";

// POST {outreachId, decision: 'approve'|'reject'} — user's decision from the draft-approval UI.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    const outreachId = Number(body.outreachId);
    const db = getDb();
    if (body.decision === "approve") {
      // A job-linked (referral) approval also enqueues a resume run if no apply run is alive,
      // so an attended session picks up the send; coffee-chat approvals just sit in sendables.
      const r = approveOutreachAndMaybeAutoStart(db, userId, outreachId);
      return NextResponse.json({ ok: true, ...r });
    } else if (body.decision === "reject") {
      rejectOutreach(db, userId, outreachId);
    } else if (body.decision === "unapprove") {
      unapproveOutreach(db, userId, outreachId);
    } else {
      throw new Error(`decide: invalid decision '${body.decision}' (must be 'approve', 'reject' or 'unapprove')`);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
