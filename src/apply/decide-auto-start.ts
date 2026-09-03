import { DB } from "@/lib/db";
import { decide } from "@/apply/queue";
import { hasLiveRun, startExecutor } from "@/executor/runner";

// Factored out of src/app/api/apply/decide/route.ts into its own module (rather than an extra
// named export on route.ts) because Next's typed-routes checker only tolerates the recognized
// HTTP-verb exports (GET/POST/...) plus a small allowlist (config, metadata, ...) on a route.ts
// file — any other export fails `tsc`/`next build`'s generated route-type validation. Living
// here also keeps it importable from tests without going through Next's request/response
// machinery.

export interface DecideAutoStartDeps {
  hasLiveRun?: typeof hasLiveRun;
  startExecutor?: typeof startExecutor;
}

export interface DecideAutoStartResult {
  autoStarted: boolean;
  runId?: number;
}

// User -> App from the in-app confirmation queue: approve or reject a filled application.
// On a successful 'approve', if no 'apply' executor is currently alive, auto-starts one in
// resume mode — otherwise an approval just sits in the DB forever with nobody to act on it (the
// gap this closes: the user clicks 确认提交 with no executor process running, and nothing
// happens). Inject hasLiveRun/startExecutor to avoid spawning a real process in tests. A spawn
// failure here must never break the approve itself, hence the try/catch: the approval already
// succeeded by the time we get here.
export function decideAndMaybeAutoStart(
  db: DB,
  jobId: number,
  decision: "approve" | "reject",
  reason: string | undefined,
  deps: DecideAutoStartDeps = {}
): DecideAutoStartResult {
  decide(db, jobId, decision, reason);

  if (decision !== "approve") {
    return { autoStarted: false };
  }

  const checkLive = deps.hasLiveRun ?? hasLiveRun;
  const start = deps.startExecutor ?? startExecutor;
  try {
    if (!checkLive(db, "apply")) {
      const result = start(db, "apply", { resume: true });
      return { autoStarted: true, runId: result.id };
    }
  } catch {
    // Spawn failure must never break the approve itself — the approval already succeeded above.
    // The user still sees "已批准" and can retry from the App's own 开始投递 button.
  }
  return { autoStarted: false };
}
