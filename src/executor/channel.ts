import { DB } from "@/lib/db";
import { ownerId } from "@/lib/users";
import { heartbeatAgeMs, HEARTBEAT_STALE_MS } from "@/executor/attended";
import { isAlive, lastRunChannel, startExecutor, type ExecutorChannel, type StartOptions } from "@/executor/runner";
import { hasResumeFor } from "@/apply/resume-select";

// Which channel an account's tasks can actually run on (2026-10-22). The box's Chrome — the one
// the dispatcher spawns `claude --chrome` sessions into — is the owner's: it is signed into the
// owner's Google and LinkedIn, so the dispatcher only ever serves the owner's queue
// (src/executor/attended.ts). Another account reaches this server from its own computer; nothing
// on the box can drive *their* Chrome. Before this module, every task such an account started
// defaulted to user_chrome and sat at 排队中 forever (the owner's brother, run #609: 嵌入式 × 12,
// queued 2026-10-23 01:10 UTC and never claimed). Their work now runs in the background browser —
// a headless session on this box with the account's own profile under data/users/<id> — unless
// they run an assistant of their own on their computer (a desktop session heartbeating with their
// personal token), which claims their user_chrome runs itself.

// Can a user_chrome run of this account be served right now? Always for the owner (the
// dispatcher spawns a session when none is online); for anyone else only while their own
// assistant is heartbeating. A box with no accounts yet (the legacy single-user setup, tests)
// counts as the owner's.
export function attendedAvailable(db: DB, userId: string, now = new Date()): boolean {
  const owner = ownerId(db);
  if (!owner || owner === userId) return true;
  const age = heartbeatAgeMs(db, userId, now);
  return age != null && age < HEARTBEAT_STALE_MS;
}

// The channel a task the App starts on its own (an approval's resume run, a resolved card, the
// assistant chat's 帮我投) goes to: the background browser for an account that cannot be served
// in Chrome, otherwise whatever the account last used, defaulting to Chrome.
export function applyChannelFor(
  db: DB,
  userId: string,
  getLastChannel: typeof lastRunChannel = lastRunChannel
): ExecutorChannel {
  if (!attendedAvailable(db, userId)) return "headless";
  return getLastChannel(db, userId, "apply") === "headless" ? "headless" : "user_chrome";
}

// Finding a referral means the assistant working LinkedIn in the account's own logged-in Chrome,
// which this box can do for its owner. For anyone else a 建议内推 tag only hides the job from their
// 海投 plan, so they get no referral suggestions (the post-scan pipeline skips the classifier for
// them and the 补判内推建议 button is not offered). Judged by account, not by a heartbeat that comes
// and goes: the suggestions are stored per job and outlive any session.
export function referralsPossible(db: DB, userId: string): boolean {
  const owner = ownerId(db);
  return !owner || owner === userId;
}

function wantsReferral(o: StartOptions): boolean {
  return o.mode === "referral" || (o.plan ?? []).some((p) => p.mode === "referral");
}

export const MEMBER_HANDOFF_SUMMARY = (to: number) => `改在后台浏览器里做:任务 #${to}(这台服务器只能操作主账号的 Chrome)`;
export const MEMBER_NO_RESUME_SUMMARY = "还没有简历,这个投递任务没法开始:先到档案页「简历」上传你的简历(PDF),再在「投递」重新开始计划。";
export const MEMBER_UNSERVABLE_SUMMARY =
  "这项任务要在你自己的 Chrome 里做(找内推 / 扫描 / 找人都要用你登录好的 LinkedIn),而这台服务器只能操作主账号的 Chrome;后台浏览器能替你做的是海投。";

export interface HandOffResult {
  moved: { from: number; to: number; userId: string }[];
  closed: number[];
}

// The dispatcher tick's safety net for the rule above: a queued user_chrome run of an account
// that cannot be served in Chrome (an old tab with the Chrome channel saved, a path that queued
// one before this module existed — run #609). A plain apply task moves to the background browser,
// one per account at a time (the background browser has one profile per account; the rest wait
// for the next tick); referral / scan / network tasks have no background equivalent and are
// closed with a summary that says why, instead of holding every auto-start guard behind them.
export function handOffUnservableRuns(
  db: DB,
  deps: { startExecutor?: typeof startExecutor; logDir?: string; now?: Date } = {}
): HandOffResult {
  const owner = ownerId(db);
  const out: HandOffResult = { moved: [], closed: [] };
  if (!owner) return out;
  const rows = db
    .prepare("SELECT id, user_id, kind, options FROM executor_runs WHERE channel = 'user_chrome' AND status = 'queued' AND user_id != ? ORDER BY id ASC")
    .all(owner) as { id: number; user_id: string; kind: string; options: string | null }[];
  const busy = new Set<string>();
  for (const row of rows) {
    if (attendedAvailable(db, row.user_id, deps.now)) continue;
    let options: StartOptions = {};
    try {
      options = JSON.parse(row.options ?? "{}") as StartOptions;
    } catch {
      options = {};
    }
    if (row.kind === "apply" && !wantsReferral(options)) {
      // A plan no resume can go with would only run dry (the picker skips resume-less tracks):
      // close it with what to do instead.
      const directions = (options.plan ?? []).map((p) => p.direction);
      if (directions.length > 0 && !directions.some((d) => hasResumeFor(db, row.user_id, d))) {
        db.prepare("UPDATE executor_runs SET status = 'failed', summary = ?, ended_at = datetime('now') WHERE id = ? AND status = 'queued'").run(
          MEMBER_NO_RESUME_SUMMARY,
          row.id
        );
        out.closed.push(row.id);
        continue;
      }
      if (busy.has(row.user_id) || headlessApplyLive(db, row.user_id)) {
        busy.add(row.user_id);
        continue;
      }
      try {
        const started = (deps.startExecutor ?? startExecutor)(db, row.user_id, "apply", options, deps.logDir ? { logDir: deps.logDir } : {}, "headless");
        db.prepare("UPDATE executor_runs SET status = 'stopped', summary = ?, ended_at = datetime('now') WHERE id = ? AND status = 'queued'").run(
          MEMBER_HANDOFF_SUMMARY(started.id),
          row.id
        );
        // The jobs the queued run was holding (a targeted run's) follow it to the new one.
        db.prepare("UPDATE applications SET run_id = ? WHERE user_id = ? AND run_id = ?").run(started.id, row.user_id, row.id);
        out.moved.push({ from: row.id, to: started.id, userId: row.user_id });
        busy.add(row.user_id);
      } catch (e) {
        console.error(`[channel] could not move run #${row.id} to the background browser`, e);
      }
      continue;
    }
    db.prepare("UPDATE executor_runs SET status = 'failed', summary = ?, ended_at = datetime('now') WHERE id = ? AND status = 'queued'").run(
      MEMBER_UNSERVABLE_SUMMARY,
      row.id
    );
    out.closed.push(row.id);
  }
  return out;
}

function headlessApplyLive(db: DB, userId: string): boolean {
  const rows = db
    .prepare("SELECT pid FROM executor_runs WHERE user_id = ? AND kind = 'apply' AND channel = 'headless' AND status = 'running'")
    .all(userId) as { pid: number | null }[];
  return rows.some((r) => isAlive(r.pid));
}
