import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser, failResponse } from "@/lib/actor";
import { inboxStatus, syncMailbox } from "@/inbox/sync";

// 设置's "sync now": one pass for the calling account, result in the response.
export const POST = withUser(async (_req, { userId }) => {
  const db = getDb();
  try {
    const summary = await syncMailbox(db, userId);
    return NextResponse.json({ ok: !summary.error, summary, status: inboxStatus(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
