import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { referralDecide, ReferralAction } from "@/apply/referral";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";
import { withUser, failResponse } from "@/lib/actor";

// POST {jobIds, action: direct|won|retry|archive, info?, personName?} — the 内推进行中 card
// buttons. The state change always happens; the follow-up run is enqueued only when no apply run
// is live/queued (the response says which, and the card keeps a 开始投 button for the other case).
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    const db = getDb();
    const jobIds = (body.jobIds as unknown[]).map(Number);
    const result = referralDecide(db, userId, {
      jobIds,
      action: body.action as ReferralAction,
      info: body.info,
      personName: body.personName,
    });
    if (!result.startMode) return NextResponse.json({ ok: true, startMode: null, autoStarted: false });
    const started = maybeAutoStartApply(db, userId, { jobIds, mode: result.startMode });
    return NextResponse.json({
      ok: true,
      startMode: result.startMode,
      ...started,
      message: started.autoStarted ? undefined : "已有投递 run 在跑,结束后请在卡片上再点一次「开始投」",
    });
  } catch (e) {
    return failResponse(e);
  }
});
