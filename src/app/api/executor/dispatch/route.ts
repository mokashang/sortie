import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchAttended, attendedStatus, failUnservableMemberRuns, heartbeatAgeMs, HEARTBEAT_STALE_MS } from "@/executor/attended";
import { maybeRefreshChrome } from "@/executor/chrome-refresh";
import { requeueStrandedApprovals } from "@/apply/decide-auto-start";
import { reclaimStrandedPrepared, retryDueErrors } from "@/apply/followup";
import { autoAnswerParkedText } from "@/apply/auto-answer";
import { pollEmailCodes } from "@/apply/email-code";
import { resumeDuePausedChains } from "@/apply/continue";
import { sweepTabs } from "@/executor/tabs";
import { ownerId } from "@/lib/users";
import { withInternal } from "@/lib/actor";
import { reapStaleRuns } from "@/executor/runner";

// The dispatcher tick (instrumentation.ts, every 10s): spawn a terminal `claude --chrome` session
// for the owner's queued user_chrome run when no attended session is alive; reap it when its run
// is done. Internal-token only (or the owner's own session).
//
// Before deciding, approvals nobody is acting on get a resume run queued (requeueStrandedApprovals,
// src/apply/decide-auto-start.ts): the finish route covers a session that ended on its own; this
// tick also covers one that went quiet and was retired as "session gone" by reapStaleRuns (run #70,
// 2026-09-14). The row it queues is dispatched in this same tick.
//
// Failures are also written to the server log (throttled: once per distinct message per 5 min),
// because the caller is a fire-and-forget timer that never reads this response — a broken spawn
// path stayed invisible for hours that way (node-pty loader, Windows, 2026-09-11).
let lastLoggedError = "";
let lastLoggedAt = 0;
export const POST = withInternal(async () => {
  try {
    const db = getDb();
    const owner = ownerId(db);
    // Dead or hung runs are retired here too, not only when an App tab polls /api/overview: with
    // no browser open (nights, days away) a hung headless claude -p kept its process and Chrome
    // forever, and its 'running' row held back every auto-start guard.
    reapStaleRuns(db);
    const unservable = failUnservableMemberRuns(db);
    if (unservable.length > 0) console.log(`[attended] failed ${unservable.join(",")}: another account's Chrome task with no session of its own`);
    // Jobs taken by a run that is over and never reported (src/apply/followup.ts): back to the
    // queue, and the ones the user answered questions for become a targeted run.
    const reclaimed = owner ? reclaimStrandedPrepared(db, owner) : undefined;
    if (reclaimed && reclaimed.reclaimed.length > 0)
      console.log(`[attended] reclaimed ${reclaimed.reclaimed.length} stranded prepared row(s); requeued ${reclaimed.requeued.join(",") || "none"}`);
    // Errors whose automatic-retry wait is over go back as a targeted run (src/apply/followup.ts).
    const retried = owner ? retryDueErrors(db, owner) : undefined;
    if (retried && retried.retried.length > 0) console.log(`[attended] auto-retrying ${retried.retried.join(",")} (run #${retried.followup?.runId ?? "?"})`);
    // Parked cards left with only text questions (a login was resolved, an old card) get the
    // App's own answers, and come back as work when nothing else is left (src/apply/auto-answer.ts).
    if (owner) void autoAnswerParkedText(db, owner);
    // An emailed verification code step: watch the mailbox for that company's code mail and show
    // it on the card for the user to type (src/apply/email-code.ts).
    if (owner) void pollEmailCodes(db, owner);
    // A plan parked until tomorrow (today's LinkedIn invite budget spent, src/apply/continue.ts)
    // has no approval or finish to wake it: it is picked up here once its time has come.
    const resumed = resumeDuePausedChains(db);
    for (const r of resumed) if (r.action === "queued") console.log(`[attended] paused plan resumed as run #${r.runId}`);
    // Tabs stuck past an hour, and the oldest ones whenever more than 30 are open: the owning
    // session closes them and their jobs are detached (src/executor/tabs.ts). Before the stranded
    // check, so an approval whose tab was just closed gets its refill queued this same tick.
    const tabs = owner ? sweepTabs(db, owner) : undefined;
    if (tabs && tabs.released.length > 0)
      console.log(`[attended] closing ${tabs.released.length} tab(s) (${tabs.open} open): ${tabs.released.map((t) => `${t.jobId}/${t.why}`).join(", ")}`);
    const stranded = owner ? requeueStrandedApprovals(db, owner) : undefined;
    if (stranded?.autoStarted) console.log(`[attended] queued resume run #${stranded.runId}: approved applications nobody was acting on`);
    const r = dispatchAttended(db);
    // Everything idle and Chrome heavy with tab groups no session can reach any more: restart the
    // job-search Chrome, at most every 6 hours (src/executor/chrome-refresh.ts).
    const chrome = maybeRefreshChrome(db, {
      desktopHeartbeat: () => {
        const age = owner ? heartbeatAgeMs(db, owner) : null;
        return age != null && age < HEARTBEAT_STALE_MS;
      },
    });
    return NextResponse.json({ ok: true, ...r, stranded, reclaimed, retried, tabs, chrome });
  } catch (e) {
    const msg = String(e);
    const now = Date.now();
    if (msg !== lastLoggedError || now - lastLoggedAt > 5 * 60_000) {
      console.error("[attended dispatch] failed:", msg);
      lastLoggedError = msg;
      lastLoggedAt = now;
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

export const GET = withInternal(async () => {
  const db = getDb();
  const owner = ownerId(db);
  return NextResponse.json(owner ? attendedStatus(db, owner) : { heartbeat: null, spawn: null });
});
