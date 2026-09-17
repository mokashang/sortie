import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchAttended, attendedStatus } from "@/executor/attended";
import { requeueStrandedApprovals } from "@/apply/decide-auto-start";
import { reclaimStrandedPrepared } from "@/apply/followup";
import { ownerId } from "@/lib/users";
import { withInternal } from "@/lib/actor";

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
    // Jobs taken by a run that is over and never reported (src/apply/followup.ts): back to the
    // queue, and the ones the user answered questions for become a targeted run.
    const reclaimed = owner ? reclaimStrandedPrepared(db, owner) : undefined;
    if (reclaimed && reclaimed.reclaimed.length > 0)
      console.log(`[attended] reclaimed ${reclaimed.reclaimed.length} stranded prepared row(s); requeued ${reclaimed.requeued.join(",") || "none"}`);
    const stranded = owner ? requeueStrandedApprovals(db, owner) : undefined;
    if (stranded?.autoStarted) console.log(`[attended] queued resume run #${stranded.runId}: approved applications nobody was acting on`);
    const r = dispatchAttended(db);
    return NextResponse.json({ ok: true, ...r, stranded, reclaimed });
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
