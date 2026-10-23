import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingConfirmations, confirmStatus } from "@/apply/queue";
import { pendingInfo } from "@/apply/info";
import { planAlerts } from "@/apply/plan-alerts";
import { withEmailCodes } from "@/apply/email-code";
import { sessionOfCaller } from "@/executor/sessions";
import { heldByOtherSession } from "@/executor/attended";
import { langFromRequest } from "@/i18n/server";
import { withUser, failResponse } from "@/lib/actor";

// No params: the in-app confirmation queue's data source. ?jobId=: single-job status poll,
// used by the executor while it waits (up to 30min) for a human to approve/reject its fill.
// &wait=N (seconds, up to 60): answer as soon as the job has something for the session — a
// decision, or the row left the waiting states (answered, skipped) — else after N seconds. The
// background browser's session waits through this instead of a shell sleep loop (2026-10-22: with
// sleep allowed, a session finished its work and then sat in "until false; do sleep 15; done"
// until the reaper killed it half an hour later).
//
// A dispatcher-spawned session asking (its resume phase looks for approvals to submit) only sees
// the filled forms that are its own or that no reachable session holds any more: with tasks
// running side by side (2026-09-30), another session's approved form is in that session's tab,
// that session has been told, and a second one refilling it would only make the user confirm
// twice — or submit it twice.
export const GET = withUser(async (req, actor) => {
  const userId = actor.userId;
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  try {
    const db = getDb();
    if (jobId) {
      const wait = Math.min(60, Math.max(0, Number(url.searchParams.get("wait")) || 0));
      const deadline = Date.now() + wait * 1000;
      let st = confirmStatus(db, userId, Number(jobId));
      while (Date.now() < deadline && !req.signal.aborted && st.decision === null && (st.status === "awaiting_confirm" || st.status === "needs_info")) {
        await new Promise((r) => setTimeout(r, 1000));
        st = confirmStatus(db, userId, Number(jobId));
      }
      return NextResponse.json(st);
    }
    let pending = pendingConfirmations(db, userId);
    const caller = sessionOfCaller(db, actor);
    if (caller) pending = pending.filter((p) => !heldByOtherSession(db, userId, p.jobId, caller));
    // needsInfo: the 待处理 cards (executor waiting on the user, or paused with its to-do items kept);
    // planAlerts: the task-level ones (a plan that stopped short, a task that gave up — plan-alerts.ts).
    // An emailed verification code the App found (src/apply/email-code.ts) rides along only for the
    // signed-in user's browser — never for an assistant's token: the code is for the user to type.
    const needsInfo = pendingInfo(db, userId, langFromRequest(req));
    return NextResponse.json({
      pending,
      needsInfo: actor.via === "session" ? withEmailCodes(needsInfo, userId) : needsInfo,
      planAlerts: planAlerts(db, userId),
    });
  } catch (e) {
    return failResponse(e);
  }
});
