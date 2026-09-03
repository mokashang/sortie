import { DB } from "@/lib/db";
import { approveOutreach, reportSent } from "@/network/gate";
import { outreachJobIds } from "@/network/crm";
import { markReached } from "@/apply/referral";
import { maybeAutoStartApply, DecideAutoStartDeps, DecideAutoStartResult } from "@/apply/decide-auto-start";

// Route-level glue for the referral pipeline, kept out of the route files so it is unit-testable
// (same reason decide-auto-start.ts exists).

// POST /api/network/decide approve: after the gate admits the draft to pending_send, a
// job-linked (referral) outreach needs an attended session to actually send it — if none is
// live/queued, enqueue a resume run (whose resume phase also sends pending_send referral
// outreach; see CLAUDE.md §3.10). Coffee-chat outreach keeps the old behaviour (network_send).
export function approveOutreachAndMaybeAutoStart(
  db: DB,
  outreachId: number,
  deps: DecideAutoStartDeps = {}
): DecideAutoStartResult {
  approveOutreach(db, outreachId);
  if (outreachJobIds(db, outreachId).length === 0) return { autoStarted: false };
  return maybeAutoStartApply(db, { resume: true }, deps);
}

// POST /api/network/report sent: the red-line gate first, then the referral clock.
export function reportSentAndMarkReached(db: DB, outreachId: number, sentText?: string): void {
  reportSent(db, outreachId, sentText);
  markReached(db, outreachId);
}
