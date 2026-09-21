import { NextResponse } from "next/server";
import { withUser } from "@/lib/actor";
import { authBaseUrl, authSecret } from "@/lib/auth";
import { authorizeUrl, signState, CALLBACK_PATH, requireGoogleCredentials } from "@/inbox/oauth";

// 设置 → 邮箱同步 → 添加邮箱: send the signed-in user to Google's consent page for one more
// mailbox (spec 2026-09-21 inbox-sync §3). Browser navigation, so a session cookie is what gets
// here; the state ties the callback to this account.
export const GET = withUser(async (req, { userId }) => {
  let clientId: string;
  try {
    clientId = requireGoogleCredentials().clientId;
  } catch {
    return NextResponse.redirect(new URL("/settings?inbox=error&reason=no_google#inbox", authBaseUrl()));
  }
  const hint = new URL(req.url).searchParams.get("hint") ?? undefined;
  const url = authorizeUrl({ clientId, redirectUri: `${authBaseUrl()}${CALLBACK_PATH}`, state: signState(authSecret(), userId), loginHint: hint });
  return NextResponse.redirect(url);
});
