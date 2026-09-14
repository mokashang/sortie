import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { claimNextRun, ExecutorChannel, ExecutorKind } from "@/executor/runner";
import { withUser, failResponse } from "@/lib/actor";

// GET /api/executor/claim-next?channel=user_chrome — the attended session's poll loop calls this
// to pick up the account's oldest queued run of the channel. Atomically flips queued -> running so
// two attended sessions polling at once can't both claim the same run. {run: null} means nothing
// is queued right now — the caller should keep polling.
export const GET = withUser(async (req, { userId }) => {
  try {
    const url = new URL(req.url);
    const channel = (url.searchParams.get("channel") as ExecutorChannel) ?? "user_chrome";
    // ?kinds=apply,referral_check — only claim runs this session knows how to work.
    const kindsParam = url.searchParams.get("kinds");
    const kinds = kindsParam ? (kindsParam.split(",").filter(Boolean) as ExecutorKind[]) : undefined;
    const run = claimNextRun(getDb(), userId, channel, kinds);
    return NextResponse.json({ run });
  } catch (e) {
    return failResponse(e);
  }
});
