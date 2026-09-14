import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { startExecutor, ExecutorKind, ExecutorChannel, StartOptions } from "@/executor/runner";
import { supersedePausedChain, APPLY_CHUNK_SIZE } from "@/apply/continue";
import { withUser, failResponse } from "@/lib/actor";

const VALID_KINDS: ExecutorKind[] = ["apply", "network_send", "network_find", "jd_review", "scan", "referral_check"];
const VALID_CHANNELS: ExecutorChannel[] = ["headless", "user_chrome"];

// POST {kind: 'apply'|'network_send'|'network_find'|'jd_review', options?, channel?: 'headless'|'user_chrome'}
// — starts an executor session for the requested kind, owned by the calling account. channel
// defaults to 'user_chrome' (the App's default: "值守会话" — an already-open interactive Claude
// Code session with the claude-in-chrome extension attached to the user's own Chrome polls
// claim-next and drives it). 'headless' spawns a detached `claude -p` process against the
// account's own Playwright browser profile. Refuses (400) if one of the same kind+channel is
// already running/queued for the account; see src/executor/runner.ts.
//
// jd_review has no user_chrome protocol (buildJdReviewPrompt only exists as a headless
// Playwright-profile prompt — there's no attended-session equivalent), so its channel is forced
// to 'headless' here regardless of what the caller passed, before channel validation runs.
//
// An apply run with a plan is the first segment of a 接力 chain (src/apply/continue.ts): it gets
// the default chunk size, and any chain of this account still parked waiting for confirmations
// is superseded.
export const POST = withUser(async (req, { userId }) => {
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
    const db = getDb();
    const options: StartOptions = body.options ?? {};
    if (kind === "apply" && Array.isArray(options.plan) && options.plan.length > 0) {
      supersedePausedChain(db, userId);
      if (typeof options.chunk !== "number" || options.chunk <= 0) options.chunk = APPLY_CHUNK_SIZE;
    }
    const result = startExecutor(db, userId, kind as ExecutorKind, options, {}, channel as ExecutorChannel);
    return NextResponse.json(result);
  } catch (e) {
    return failResponse(e);
  }
});
