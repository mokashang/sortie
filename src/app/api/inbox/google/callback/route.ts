import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { authBaseUrl, authSecret } from "@/lib/auth";
import { verifyState, CALLBACK_PATH, ConnectError } from "@/inbox/oauth";
import { completeGoogleConnect, syncMailbox } from "@/inbox/sync";

// Google sends the browser back here after consent. The state names the account that started
// the flow and must match the session that arrives (a stranger cannot attach a mailbox to
// someone else's account by replaying a link). On success the mailbox is stored and its first
// sync runs before the redirect, so 设置 shows results right away.
function back(params: Record<string, string>): Response {
  const q = new URLSearchParams(params);
  return NextResponse.redirect(new URL(`/settings?${q}#inbox`, authBaseUrl()));
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const db = getDb();
  const actor = await getActor(req, db);
  if (!actor) return NextResponse.redirect(new URL("/login?next=/settings", authBaseUrl()));
  const stateUser = verifyState(authSecret(), url.searchParams.get("state"));
  if (!stateUser || stateUser !== actor.userId) return back({ inbox: "error", reason: "state" });
  if (url.searchParams.get("error")) return back({ inbox: "error", reason: "denied" });
  const code = url.searchParams.get("code");
  if (!code) return back({ inbox: "error", reason: "denied" });
  try {
    const row = await completeGoogleConnect(db, actor.userId, code, { redirectUri: `${authBaseUrl()}${CALLBACK_PATH}` });
    await syncMailbox(db, row, {});
    return back({ inbox: "connected", email: row.email });
  } catch (e) {
    const reason = e instanceof ConnectError ? e.code : "exchange";
    console.error("[inbox] connect failed:", e instanceof Error ? e.message : e);
    return back({ inbox: "error", reason });
  }
}
