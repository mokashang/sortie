import { DB } from "@/lib/db";
import { decide } from "@/apply/queue";
import { hasLiveOrQueuedRun, lastRunChannel, startExecutor, ExecutorChannel, StartOptions } from "@/executor/runner";
import { resumePausedChainIfReady } from "@/apply/continue";
import { isAttendedSessionReachable, notifyAttendedSession } from "@/executor/attended";
import { approvedNotice, rejectedNotice } from "@/executor/attended-session";
import { queueTargetedRun } from "@/apply/followup";

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
  // The long-lived attended session (src/executor/attended.ts): whether this process can type
  // into it, and the typing itself. Tests fake both.
  attendedReachable?: () => boolean;
  notifyAttended?: (line: string) => boolean;
}

export interface DecideAutoStartResult {
  autoStarted: boolean;
  runId?: number;
  channel?: ExecutorChannel;
  // The live attended session was told directly (no run queued): it submits in its own tab.
  notified?: boolean;
}

// User -> App from the in-app confirmation queue: approve or reject a filled application.
// On a successful 'approve', if no 'apply' executor is currently alive or queued for this
// account, auto-starts one in resume mode — otherwise an approval just sits in the DB forever
// with nobody to act on it (the gap this closes: the user clicks 确认提交 with no executor
// running, and nothing happens).
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
export function maybeAutoStartApply(db: DB, userId: string, options: StartOptions, deps: DecideAutoStartDeps = {}): DecideAutoStartResult {
  // A run scoped to specific jobs (a resolved 待处理 card, the referral board's buttons) must
  // happen even while another run is on: it is merged into a queued targeted run or queued behind
  // the running one — see src/apply/followup.ts. Only the bare resume run stands down for a live run.
  if (Array.isArray(options.jobIds) && options.jobIds.length > 0) {
    return queueTargetedRun(db, userId, options.jobIds, options.mode === "referral" ? "referral" : "direct", deps);
  }
  const checkLiveOrQueued = deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun;
  const getLastChannel = deps.lastRunChannel ?? lastRunChannel;
  const start = deps.startExecutor ?? startExecutor;
  try {
    if (!checkLiveOrQueued(db, userId, "apply")) {
      const channel: ExecutorChannel = getLastChannel(db, userId, "apply") === "headless" ? "headless" : "user_chrome";
      const result = start(db, userId, "apply", options, {}, channel);
      return { autoStarted: true, runId: result.id, channel };
    }
  } catch {
    // The user still sees "已批准" and can retry from the App's own 开始投递 button.
  }
  return { autoStarted: false };
}

export function decideAndMaybeAutoStart(
  db: DB,
  userId: string,
  jobId: number,
  decision: "approve" | "reject",
  reason: string | undefined,
  deps: DecideAutoStartDeps = {}
): DecideAutoStartResult {
  decide(db, userId, jobId, decision, reason);
  // A 接力 chain parked behind the confirmation backlog (src/apply/continue.ts) gets first claim
  // on the session: approving or rejecting shrinks the backlog, and the chain's next segment
  // starts with the resume phase, so it submits the approvals itself.
  const resumed = resumePausedChainIfReady(db, userId, deps);
  if (resumed.action === "queued") return { autoStarted: true, runId: resumed.runId, channel: resumed.channel };
  // The session that filled the form is still alive at its prompt with the tab open: tell it
  // (the App types into its terminal) and it submits — or closes the tab — right there. Only
  // when there is no reachable session does an approval queue a resume run for a fresh one,
  // which cannot see the old tab and has to refill (2026-09-17).
  const company = (db.prepare("SELECT company FROM jobs WHERE id = ?").get(jobId) as { company: string | null } | undefined)?.company ?? "";
  const line = decision === "approve" ? approvedNotice(jobId, company) : rejectedNotice(jobId, company);
  try {
    if ((deps.notifyAttended ?? ((l: string) => notifyAttendedSession(db, l)))(line)) return { autoStarted: false, notified: true };
  } catch {
    // fall through to the queue-a-run path
  }
  if (decision !== "approve") return { autoStarted: false };
  return maybeAutoStartApply(db, userId, { resume: true }, deps);
}

// A resume:true run with nothing else to do — the shape maybeAutoStartApply queues for approvals.
// A 接力 segment (resume + plan) and a targeted run (jobIds) are real work, not this.
export function isBareResumeRun(options: unknown): boolean {
  if (!options || typeof options !== "object") return false;
  const o = options as StartOptions;
  const hasPlan = Array.isArray(o.plan) && o.plan.length > 0;
  const hasJobs = Array.isArray(o.jobIds) && o.jobIds.length > 0;
  return o.resume === true && !hasPlan && !hasJobs;
}

function lastApplyRun(db: DB, userId: string): { status: string; options: unknown } | null {
  const row = db
    .prepare("SELECT status, options FROM executor_runs WHERE user_id = ? AND kind = 'apply' ORDER BY id DESC LIMIT 1")
    .get(userId) as { status: string; options: string } | undefined;
  if (!row) return null;
  let options: unknown = {};
  try {
    options = JSON.parse(row.options);
  } catch {
    options = {};
  }
  return { status: row.status, options };
}

// The mirror image of the approve-time auto-start above: an approval that lands while a
// user_chrome run is marked running is left to that session (hasLiveOrQueuedRun says so), and
// when the session then ends without submitting it, nobody ever picks the approval up again.
// Run #71 (2026-09-14) finished ten seconds after the click; run #70 went quiet and reapStaleRuns
// retired it as "session gone" — both left approved rows sitting at awaiting_confirm while the
// card promised 助手会接着提交. Called when a run ends (the finish route) and from the dispatcher
// tick (which also covers reaped runs), this queues a resume run once nothing is live or queued.
//
// Bounded on purpose — at most one such run per real run: nothing is queued when the account's
// latest apply run is itself a bare resume run (it either already handled the approvals or
// failed, and re-queueing would spawn a session every few minutes until something changed) or
// was stopped by the user (a stop must not restart itself ten seconds later). In those cases the
// user restarts from the App; the failed/stopped task is on the assistant card. Never throws.
export function requeueStrandedApprovals(db: DB, userId: string, deps: DecideAutoStartDeps = {}): DecideAutoStartResult {
  const checkLiveOrQueued = deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun;
  try {
    if (checkLiveOrQueued(db, userId, "apply")) return { autoStarted: false };
    // A reachable attended session was told about each approval as it happened and still holds
    // the tabs; queueing a run would only make a second session refill the same forms.
    if ((deps.attendedReachable ?? (() => isAttendedSessionReachable(db)))()) return { autoStarted: false };
    const last = lastApplyRun(db, userId);
    if (last && (last.status === "stopped" || isBareResumeRun(last.options))) return { autoStarted: false };
    const stranded = db
      .prepare("SELECT COUNT(*) n FROM applications WHERE user_id = ? AND status = 'awaiting_confirm' AND confirm_decision = 'approved'")
      .get(userId) as { n: number };
    if (stranded.n === 0) return { autoStarted: false };
    // A parked 接力 chain gets first claim on the session: its next segment starts with the
    // resume phase, so it submits the approvals itself.
    const resumed = resumePausedChainIfReady(db, userId, deps);
    if (resumed.action === "queued") return { autoStarted: true, runId: resumed.runId, channel: resumed.channel };
    return maybeAutoStartApply(db, userId, { resume: true }, deps);
  } catch {
    return { autoStarted: false };
  }
}
