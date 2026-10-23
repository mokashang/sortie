import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { getDb, logEvent } from "@/lib/db";
import { finishRun } from "@/executor/runner";
import { tryAcquireMatching, releaseMatching } from "@/matcher/inflight";
import { maybeContinueApplyRun, resumePausedChainIfReady, ContinueResult } from "@/apply/continue";
import { requeueStrandedApprovals, DecideAutoStartResult } from "@/apply/decide-auto-start";
import { reclaimStrandedPrepared, ReclaimResult } from "@/apply/followup";
import { requeueStrandedFollowups } from "@/apply/referral-check";
import { notifyFailedRun } from "@/apply/plan-alerts";
import { withUser, failResponse } from "@/lib/actor";

// POST {runId, status: 'done'|'failed'|'stopped', summary?} — the attended session calls this
// when it's done driving the browser for a run. Only valid from 'running'/'queued'; see
// src/executor/runner.ts's finishRun for the full transition rules.
//
// Only the user stops a task (/api/executor/stop marks it 'stopped' before the session hears of
// it, so a session's own finish never meets a running row it may stop). A session reporting
// 'stopped' on a running task is the session deciding to halt by itself — task #453, 2026-10-16,
// paused a 1530-job plan over LinkedIn pacing and left its question in the summary, where nobody
// saw it for 11 hours. That is recorded as 'done' and the chain goes on; pacing is the App's job
// (src/apply/invite-budget.ts). A targeted task reported 'failed' with jobs untouched gets a
// 待处理 card (src/apply/plan-alerts.ts) and a push, instead of a question in its summary.
// Body via readJsonBody rather than req.json(): inline curl bodies from the session arrive
// GBK-encoded on Windows (see src/lib/request-body.ts).
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await readJsonBody(req);
    const asked = body.status as string;
    if (asked !== "done" && asked !== "failed" && asked !== "stopped") {
      return NextResponse.json({ error: `invalid status '${asked}'` }, { status: 400 });
    }
    const db = getDb();
    const runId = Number(body.runId);
    const status = asked === "stopped" ? "done" : asked;
    finishRun(db, userId, runId, status, body.summary ?? undefined);
    if (asked === "stopped") {
      logEvent(db, "run_stop_by_session_ignored", { userId, entity: "run", entityId: runId, payload: { summary: String(body.summary ?? "").slice(0, 500) } });
      console.log(`[finish] run #${runId}: the session asked to stop on its own; recorded as done, the plan goes on`);
    }

    const run = db.prepare("SELECT kind FROM executor_runs WHERE id=?").get(runId) as { kind: string } | undefined;
    if (run?.kind === "apply" && status === "failed") notifyFailedRun(db, userId, runId);

    // 接力 (src/apply/continue.ts): a finished apply segment may need the next one queued (or
    // parked behind the confirmation backlog); any other apply run finishing (a bare resume run,
    // say) frees the session for a chain of this account that was parked.
    let continuation: ContinueResult | undefined;
    // An approval that landed while this run was still marked running was left to its session
    // (decide's auto-start stands down for a live run). If the session ended without submitting
    // it — run #71 finished ten seconds after the click, 2026-09-14 — queue a resume run now;
    // see requeueStrandedApprovals for the bounds.
    let stranded: DecideAutoStartResult | undefined;
    // Jobs this run took and never reported go back to the queue first (answered ones become a
    // targeted run, src/apply/followup.ts), so the chain / resume bookkeeping below sees them.
    let reclaimed: ReclaimResult | undefined;
    if (run?.kind === "apply") {
      reclaimed = reclaimStrandedPrepared(db, userId);
      continuation = maybeContinueApplyRun(db, runId);
      if (continuation.action === "none") continuation = resumePausedChainIfReady(db, userId);
      if (continuation.action === "none") stranded = requeueStrandedApprovals(db, userId);
    }

    // A referral follow-up approved while this check was already running may have been missed.
    let followupRun: number | null = null;
    if (run?.kind === "referral_check") followupRun = requeueStrandedFollowups(db, userId, runId);

    if (run?.kind === "jd_review") {
      // 回流的 discovered 行带完整 JD 重打(每个账号各自),然后若还有待补且未到每日上限,接力下一个 run。不 await:
      // 匹配可能跑几分钟,HTTP 响应不能等。`tryAcquireMatching()` is the same process-wide lock the
      // scan route uses — if a scan-triggered matching pass is already running, skip re-matching
      // here (it'll pick up these rows on its own next pass) and just try the relay.
      void (async () => {
        try {
          const { maybeStartJdReview } = await import("@/jd-review/relay");
          if (tryAcquireMatching()) {
            try {
              const { getBackend } = await import("@/llm/registry");
              const { matchAllUsers } = await import("@/scanner/relay");
              await matchAllUsers(db, { backend: getBackend(), limit: 200, concurrency: 6 });
            } finally {
              releaseMatching();
            }
            console.log("[jd_review→relay]", maybeStartJdReview(db));
          } else {
            console.log("[jd_review→relay] matching already in flight, relay only", maybeStartJdReview(db));
          }
        } catch (e) {
          console.error("[jd_review finish chain]", e);
        }
      })();
    }

    return NextResponse.json({ ok: true, recordedAs: status, continuation, stranded, reclaimed, followupRun });
  } catch (e) {
    return failResponse(e);
  }
});
