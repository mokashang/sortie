import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { finishRun } from "@/executor/runner";

// POST {runId, status: 'done'|'failed'|'stopped', summary?} — the attended session calls this
// when it's done driving the browser for a run (or the user interrupted it). Only valid from
// 'running'/'queued'; see src/executor/runner.ts's finishRun for the full transition rules.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const status = body.status as string;
    if (status !== "done" && status !== "failed" && status !== "stopped") {
      return NextResponse.json({ error: `invalid status '${status}'` }, { status: 400 });
    }
    const db = getDb();
    finishRun(db, Number(body.runId), status, body.summary ?? undefined);

    const run = db.prepare("SELECT kind FROM executor_runs WHERE id=?").get(Number(body.runId)) as { kind: string } | undefined;
    if (run?.kind === "jd_review") {
      // 回流的 discovered 行带完整 JD 重打,然后若还有待补且未到每日上限,接力下一个 run。不 await:
      // 匹配可能跑几分钟,HTTP 响应不能等。
      void (async () => {
        try {
          const { loadProfile } = await import("@/lib/profile");
          const { getBackend } = await import("@/llm/registry");
          const { runMatching } = await import("@/matcher/run");
          const { maybeStartJdReview } = await import("@/jd-review/relay");
          const profile = loadProfile();
          await runMatching(db, {
            backend: getBackend(), profile: { directions: profile.directions, work_auth: profile.work_auth },
            batchSize: 10, threshold: 40, limit: 200, concurrency: 6,
          });
          console.log("[jd_review→relay]", maybeStartJdReview(db));
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
