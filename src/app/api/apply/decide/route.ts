import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { decideAndMaybeAutoStart } from "@/apply/decide-auto-start";
import { withUser, failResponse, requireBrowser } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// User -> App from the in-app confirmation queue: approve or reject a filled application. See
// decideAndMaybeAutoStart for the auto-start-on-approve behavior — factored into its own module
// (rather than living here) so it stays importable from tests without going through Next's
// route-type validation, which only tolerates the recognized HTTP-verb exports on route.ts.
export const POST = withUser(async (req, actor) => {
  requireBrowser(actor);
  const { userId } = actor;
  const body = await readJsonBody(req);
  try {
    const result = decideAndMaybeAutoStart(getDb(), userId, Number(body.jobId), body.decision, body.reason);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return failResponse(e);
  }
});
