import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser, failResponse } from "@/lib/actor";
import { disconnectMailbox, inboxStatus } from "@/inbox/sync";

// Forget one mailbox: {accountId}. The token row goes, the grant is revoked at Google (best
// effort). The mail_events already recorded stay — they are history.
export const POST = withUser(async (req, { userId }) => {
  const db = getDb();
  try {
    const body = (await req.json()) as { accountId?: unknown };
    if (typeof body.accountId !== "number") return NextResponse.json({ error: "accountId must be a number" }, { status: 400 });
    const removed = await disconnectMailbox(db, userId, body.accountId);
    return NextResponse.json({ ok: removed, status: inboxStatus(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
