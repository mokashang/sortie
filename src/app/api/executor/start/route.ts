import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { startExecutor, ExecutorKind, ExecutorChannel, ExecutorStartError } from "@/executor/runner";
import { langFromRequest, messagesFor } from "@/i18n/server";

const VALID_KINDS: ExecutorKind[] = ["apply", "network_send", "network_find", "jd_review", "scan", "referral_check"];
const VALID_CHANNELS: ExecutorChannel[] = ["headless", "user_chrome"];

// POST {kind: 'apply'|'network_send'|'network_find'|'jd_review', options?, channel?: 'headless'|'user_chrome'}
// — starts an executor session for the requested kind. channel defaults to 'user_chrome' (the
// App's default: "值守会话" — an already-open interactive Claude Code session with the
// claude-in-chrome extension attached to the user's own Chrome polls claim-next and drives it).
// 'headless' spawns a detached `claude -p` process against its own Playwright browser profile, as
// before. Refuses (400) if one of the same kind+channel is already running/queued; see
// src/executor/runner.ts for the full duplicate-kind/PID-liveness/queued logic.
//
// jd_review has no user_chrome protocol (buildJdReviewPrompt only exists as a headless
// Playwright-profile prompt — there's no attended-session equivalent), so its channel is forced
// to 'headless' here regardless of what the caller passed, before channel validation runs. The
// App UI is expected to pin jd_review to headless too (a later task), but the route enforces it
// either way so an omitted/misrouted `channel` can never queue a jd_review run onto a channel
// with no attended-session protocol to service it.
//
// A channel/mode mismatch (referrals or scanning on the headless channel) comes back as an
// ExecutorStartError with a code; the message shown in the App's toast is picked in the UI
// language of the request.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const kind = body.kind as string;
    if (!VALID_KINDS.includes(kind as ExecutorKind)) {
      return NextResponse.json({ error: `invalid kind '${kind}' (must be one of ${VALID_KINDS.join(", ")})` }, { status: 400 });
    }
    const channel = kind === "jd_review" ? "headless" : ((body.channel as string) ?? "user_chrome");
    if (!VALID_CHANNELS.includes(channel as ExecutorChannel)) {
      return NextResponse.json(
        { error: `invalid channel '${channel}' (must be one of ${VALID_CHANNELS.join(", ")})` },
        { status: 400 }
      );
    }
    const result = startExecutor(getDb(), kind as ExecutorKind, body.options ?? {}, {}, channel as ExecutorChannel);
    return NextResponse.json(result);
  } catch (e) {
    const error = e instanceof ExecutorStartError ? messagesFor(langFromRequest(req)).errors[e.code] : String(e);
    return NextResponse.json({ error }, { status: 400 });
  }
}
