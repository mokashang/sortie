import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { approveOutreach, rejectOutreach } from "@/network/gate";

// POST {outreachId, decision: 'approve'|'reject'} — user's decision from the draft-approval UI.
export async function POST(req: Request) {
  const body = await req.json();
  const outreachId = Number(body.outreachId);
  try {
    if (body.decision === "approve") {
      approveOutreach(getDb(), outreachId);
    } else if (body.decision === "reject") {
      rejectOutreach(getDb(), outreachId);
    } else {
      throw new Error(`decide: invalid decision '${body.decision}' (must be 'approve' or 'reject')`);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
