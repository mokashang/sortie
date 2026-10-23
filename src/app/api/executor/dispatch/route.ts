import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchAttended, attendedStatus } from "@/executor/attended";
import { requeueStrandedApprovals } from "@/apply/decide-auto-start";
import { reclaimStrandedPrepared, retryDueErrors } from "@/apply/followup";
import { autoAnswerParkedText } from "@/apply/auto-answer";
import { pollEmailCodes } from "@/apply/email-code";
import { resumeDuePausedChains } from "@/apply/continue";
import { ownerId } from "@/lib/users";
import { withInternal } from "@/lib/actor";
import { reapStaleRuns } from "@/executor/runner";
import { handOffUnservableRuns } from "@/executor/channel";
import type { DB } from "@/lib/db";

// The accounts whose applications the tick looks after: the owner, plus anyone with a task in
// the last 30 days (2026-10-22: the stranded-row reclaim, the automatic error retries, the
// parked-question answers and the approval requeue used to run for the owner only, so another
// account's error rows — hidden from the cards while they wait for their retry — were never
// retried and never shown).
function tendedAccounts(db: DB, owner: string | null): string[] {
  const rows = db
    .prepare("SELECT DISTINCT user_id FROM executor_runs WHERE started_at >= datetime('now', '-30 days')")
    .all() as { user_id: string }[];
  const ids = new Set(rows.map((r) => r.user_id));
  if (owner) ids.add(owner);
  return [...ids].sort((a, b) => (a === owner ? -1 : b === owner ? 1 : a.localeCompare(b)));
}

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
    // Another account's Chrome task this box cannot serve moves to the background browser (or is
    // closed with the reason) instead of waiting forever (src/executor/channel.ts).
    const handed = handOffUnservableRuns(db);
    for (const m of handed.moved) console.log(`[attended] run #${m.from} of ${m.userId} moved to the background browser as #${m.to}`);
    if (handed.closed.length > 0) console.log(`[attended] closed Chrome-only run(s) ${handed.closed.join(",")}: no assistant of that account online`);
    const accounts = tendedAccounts(db, owner);
    let reclaimed: ReturnType<typeof reclaimStrandedPrepared> | undefined;
    let retried: ReturnType<typeof retryDueErrors> | undefined;
    for (const userId of accounts) {
      // Jobs taken by a run that is over and never reported (src/apply/followup.ts): back to the
      // queue, and the ones the user answered questions for become a targeted run.
      const rec = reclaimStrandedPrepared(db, userId);
      if (rec.reclaimed.length > 0)
        console.log(`[attended] reclaimed ${rec.reclaimed.length} stranded prepared row(s); requeued ${rec.requeued.join(",") || "none"}`);
      // Errors whose automatic-retry wait is over go back as a targeted run (src/apply/followup.ts).
      const ret = retryDueErrors(db, userId);
      if (ret.retried.length > 0) console.log(`[attended] auto-retrying ${ret.retried.join(",")} (run #${ret.followup?.runId ?? "?"})`);
      if (userId === owner) {
        reclaimed = rec;
        retried = ret;
      }
      // Parked cards left with only text questions (a login was resolved, an old card) get the
      // App's own answers, and come back as work when nothing else is left (src/apply/auto-answer.ts).
      void autoAnswerParkedText(db, userId);
      // An emailed verification code step: watch the mailbox for that company's code mail and show
      // it on the card for the user to type (src/apply/email-code.ts).
      void pollEmailCodes(db, userId);
    }
    // A plan parked until tomorrow (today's LinkedIn invite budget spent, src/apply/continue.ts)
    // has no approval or finish to wake it: it is picked up here once its time has come.
    const resumed = resumeDuePausedChains(db);
    for (const r of resumed) if (r.action === "queued") console.log(`[attended] paused plan resumed as run #${r.runId}`);
    let stranded: ReturnType<typeof requeueStrandedApprovals> | undefined;
    for (const userId of accounts) {
      const st = requeueStrandedApprovals(db, userId);
      if (st.autoStarted) console.log(`[attended] queued resume run #${st.runId}: approved applications nobody was acting on`);
      if (userId === owner) stranded = st;
    }
    const r = dispatchAttended(db);
    return NextResponse.json({ ok: true, ...r, stranded, reclaimed, retried, handed });
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
