import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser, failResponse, requestLang } from "@/lib/actor";
import { messages } from "@/i18n/messages";
import { connectFromGoogleAccount, InboxConnectError, inboxStatus, syncMailbox } from "@/inbox/sync";

// 设置 → 邮箱同步 → after the Gmail link round-trip: adopt the refresh token Better Auth stored on
// the google account row and run the first sync right away (spec 2026-09-21 inbox-sync §3).
export const POST = withUser(async (req, { userId }) => {
  const db = getDb();
  try {
    connectFromGoogleAccount(db, userId);
  } catch (e) {
    if (e instanceof InboxConnectError) {
      const t = messages[requestLang(req)].inbox.connectError;
      return NextResponse.json({ error: t[e.code], code: e.code }, { status: 409 });
    }
    return failResponse(e);
  }
  const summary = await syncMailbox(db, userId);
  return NextResponse.json({ ok: true, status: inboxStatus(db, userId), summary });
});
