import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { getDb } from "@/lib/db";
import { finishRun } from "@/executor/runner";
import { tryAcquireMatching, releaseMatching } from "@/matcher/inflight";

// POST {runId, status: 'done'|'failed'|'stopped', summary?} — the attended session calls this
// when it's done driving the browser for a run (or the user interrupted it). Only valid from
// 'running'/'queued'; see src/executor/runner.ts's finishRun for the full transition rules.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    const status = body.status as string;
    if (status !== "done" && status !== "failed" && status !== "stopped") {
      return NextResponse.json({ error: `invalid status '${status}'` }, { status: 400 });
    }
    const db = getDb();
    finishRun(db, Number(body.runId), status, body.summary ?? undefined);

    const run = db.prepare("SELECT kind FROM executor_runs WHERE id=?").get(Number(body.runId)) as { kind: string } | undefined;
    if (run?.kind === "jd_review") {
      // 回流的 discovered 行带完整 JD 重打,然后若还有待补且未到每日上限,接力下一个 run。不 await:
      // 匹配可能跑几分钟,HTTP 响应不能等。`tryAcquireMatching()` is the same process-wide lock the
      // scan route uses — if a scan-triggered matching pass is already running, skip re-matching
      // here (it'll pick up these rows on its own next pass) and just try the relay.
      void (async () => {
        try {
          const { maybeStartJdReview } = await import("@/jd-review/relay");
          if (tryAcquireMatching()) {
            try {
              const { loadProfile } = await import("@/lib/profile");
              const { getBackend } = await import("@/llm/registry");
              const { runMatching } = await import("@/matcher/run");
              const profile = loadProfile();
              await runMatching(db, {
                backend: getBackend(), profile: { directions: profile.directions, work_auth: profile.work_auth },
                batchSize: 10, threshold: 40, limit: 200, concurrency: 6,
              });
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

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
