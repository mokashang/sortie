import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser, failResponse } from "@/lib/actor";
import { inboxStatus, syncUserMailboxes } from "@/inbox/sync";
import { readJsonBody } from "@/lib/request-body";

// 设置's "sync now": {accountId?} — one mailbox, or every mailbox of the calling account.
export const POST = withUser(async (req, { userId }) => {
  const db = getDb();
  try {
    const body = (await readJsonBody(req, { allowEmpty: true })) as { accountId?: unknown };
    const accountId = typeof body.accountId === "number" ? body.accountId : undefined;
    const summaries = await syncUserMailboxes(db, userId, { accountId });
    return NextResponse.json({ ok: summaries.every((s) => !s.error), summaries, status: inboxStatus(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
