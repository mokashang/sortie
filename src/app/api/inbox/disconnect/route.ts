import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser, failResponse } from "@/lib/actor";
import { disconnectMailbox, inboxStatus } from "@/inbox/sync";

// Forget the mailbox: the token row goes, the grant is revoked at Google (best effort). The
// mail_events already recorded stay — they are history.
export const POST = withUser(async (_req, { userId }) => {
  const db = getDb();
  try {
    await disconnectMailbox(db, userId);
    return NextResponse.json({ ok: true, status: inboxStatus(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
