import { DB } from "@/lib/db";
import { decide } from "@/apply/queue";
import { hasLiveOrQueuedRun, lastRunChannel, startExecutor, ExecutorChannel, StartOptions } from "@/executor/runner";
import { resumePausedChainIfReady } from "@/apply/continue";

// Factored out of src/app/api/apply/decide/route.ts into its own module (rather than an extra
// named export on route.ts) because Next's typed-routes checker only tolerates the recognized
// HTTP-verb exports (GET/POST/...) plus a small allowlist (config, metadata, ...) on a route.ts
// file — any other export fails `tsc`/`next build`'s generated route-type validation. Living
// here also keeps it importable from tests without going through Next's request/response
// machinery.

export interface DecideAutoStartDeps {
  hasLiveOrQueuedRun?: typeof hasLiveOrQueuedRun;
  lastRunChannel?: typeof lastRunChannel;
  startExecutor?: typeof startExecutor;
  // Log dir for a resumed 接力 segment (tests point it at a temp dir).
  logDir?: string;
}

export interface DecideAutoStartResult {
  autoStarted: boolean;
  runId?: number;
  channel?: ExecutorChannel;
}

// User -> App from the in-app confirmation queue: approve or reject a filled application.
// On a successful 'approve', if no 'apply' executor is currently alive or queued, auto-starts one
// in resume mode — otherwise an approval just sits in the DB forever with nobody to act on it
// (the gap this closes: the user clicks 确认提交 with no executor running, and nothing happens).
//
// Which channel to auto-start follows whatever the user last used for 'apply' — headless stays
// headless, user_chrome stays user_chrome — and defaults to user_chrome (the App's default
// channel) when there's no prior run to follow at all. A user_chrome auto-start just enqueues a
// row for an attended session to pick up (no process spawned here); the App's toast/status UI
// tells the user it's waiting on their 值守会话.
//
// Inject hasLiveOrQueuedRun/lastRunChannel/startExecutor to avoid touching a real DB/process in
// tests. A failure here must never break the approve itself, hence the try/catch: the approval
// already succeeded by the time we get here.
// Enqueue/spawn an 'apply' run with `options` unless one is already live or queued. Shared by
// the apply confirm (resume:true), the network approve for job-linked outreach (resume:true) and
// the referral board's 直接投/有内推/换人 buttons ({jobIds, mode}). Never throws: a failure here
// must never break the caller's own state change, which already succeeded.
export function maybeAutoStartApply(db: DB, options: StartOptions, deps: DecideAutoStartDeps = {}): DecideAutoStartResult {
  const checkLiveOrQueued = deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun;
  const getLastChannel = deps.lastRunChannel ?? lastRunChannel;
  const start = deps.startExecutor ?? startExecutor;
  try {
    if (!checkLiveOrQueued(db, "apply")) {
      const channel: ExecutorChannel = getLastChannel(db, "apply") === "headless" ? "headless" : "user_chrome";
      const result = start(db, "apply", options, {}, channel);
      return { autoStarted: true, runId: result.id, channel };
    }
  } catch {
    // The user still sees "已批准" and can retry from the App's own 开始投递 button.
  }
  return { autoStarted: false };
}

export function decideAndMaybeAutoStart(
  db: DB,
  jobId: number,
  decision: "approve" | "reject",
  reason: string | undefined,
  deps: DecideAutoStartDeps = {}
): DecideAutoStartResult {
  decide(db, jobId, decision, reason);
  // A 接力 chain parked behind the confirmation backlog (src/apply/continue.ts) gets first claim
  // on the session: approving or rejecting shrinks the backlog, and the chain's next segment
  // starts with the resume phase, so it submits the approvals itself.
  const resumed = resumePausedChainIfReady(db, deps);
  if (resumed.action === "queued") return { autoStarted: true, runId: resumed.runId, channel: resumed.channel };
  if (decision !== "approve") return { autoStarted: false };
  return maybeAutoStartApply(db, { resume: true }, deps);
}
