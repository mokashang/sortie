import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { getDb } from "@/lib/db";
import { finishRun } from "@/executor/runner";
import { tryAcquireMatching, releaseMatching } from "@/matcher/inflight";
import { maybeContinueApplyRun, resumePausedChainIfReady, ContinueResult } from "@/apply/continue";
import { requeueStrandedApprovals, DecideAutoStartResult } from "@/apply/decide-auto-start";
import { withUser, failResponse } from "@/lib/actor";

// POST {runId, status: 'done'|'failed'|'stopped', summary?} — the attended session calls this
// when it's done driving the browser for a run (or the user interrupted it). Only valid from
// 'running'/'queued'; see src/executor/runner.ts's finishRun for the full transition rules.
// Body via readJsonBody rather than req.json(): inline curl bodies from the session arrive
// GBK-encoded on Windows (see src/lib/request-body.ts).
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await readJsonBody(req);
    const status = body.status as string;
    if (status !== "done" && status !== "failed" && status !== "stopped") {
      return NextResponse.json({ error: `invalid status '${status}'` }, { status: 400 });
    }
    const db = getDb();
    const runId = Number(body.runId);
    finishRun(db, userId, runId, status, body.summary ?? undefined);

    const run = db.prepare("SELECT kind FROM executor_runs WHERE id=?").get(runId) as { kind: string } | undefined;

    // 接力 (src/apply/continue.ts): a finished apply segment may need the next one queued (or
    // parked behind the confirmation backlog); any other apply run finishing (a bare resume run,
    // say) frees the session for a chain of this account that was parked.
    let continuation: ContinueResult | undefined;
    // An approval that landed while this run was still marked running was left to its session
    // (decide's auto-start stands down for a live run). If the session ended without submitting
    // it — run #71 finished ten seconds after the click, 2026-09-14 — queue a resume run now;
    // see requeueStrandedApprovals for the bounds.
    let stranded: DecideAutoStartResult | undefined;
    if (run?.kind === "apply") {
      continuation = maybeContinueApplyRun(db, runId);
      if (continuation.action === "none") continuation = resumePausedChainIfReady(db, userId);
      if (continuation.action === "none") stranded = requeueStrandedApprovals(db, userId);
    }

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

    return NextResponse.json({ ok: true, continuation, stranded });
  } catch (e) {
    return failResponse(e);
  }
});
