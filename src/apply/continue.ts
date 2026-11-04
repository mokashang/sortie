import fs from "fs";
import path from "path";
import { DB } from "@/lib/db";
import type { CampaignInfo, ChainInfo, ModeCounts } from "@/app/lib/run-outcome";
import { APPLY_CHUNK_SIZE, BACKLOG_PAUSE_AT, BACKLOG_RESUME_AT } from "@/app/lib/run-outcome";
import { rowResult, plannedCounts, recordChainEnd, ClaimedRow, ChainEnd } from "@/apply/run-outcome";
import { startExecutor, hasLiveOrQueuedRun, ExecutorChannel, StartOptions } from "@/executor/runner";
import { inviteBudget } from "@/apply/invite-budget";
import { SUBMIT_BLOCKED_PREFIX } from "@/apply/queue";
import { notify } from "@/lib/notify";
import { serverLang } from "@/lib/prefs";
import { messages } from "@/i18n/messages";
import { dataDir } from "@/lib/paths";

export { APPLY_CHUNK_SIZE, BACKLOG_PAUSE_AT, BACKLOG_RESUME_AT };

// 接力(2026-09-13,用户定的):一个助手会话撑不了 70 份——任务 #68 计划海投 70,会话一开始就写下「不可能
// 在一个任务里做完」,填到第 11 个就收工。所以计划再大,一个 run 也只做一段(options.chunk,默认 10 份);
// 收工时服务器按 applications.run_id 算出各条目还剩多少,自动排下一段(options.chain 记 root / 第几段 /
// 累计,并带 resume:true 先补提交已批准的),直到达标、没货、或连续两段零进展;用户点停止就断链。
// 填好的申请每份占一个 Chrome 标签页等用户确认,未确认的积压到 BACKLOG_PAUSE_AT 份时下一段先以
// status='paused' 挂着(界面「已暂停」),用户确认/退回到 BACKLOG_RESUME_AT 份以下自动转 queued。
// 一条链属于一个账号(executor_runs.user_id):积压、暂停、接续都只看该账号自己的行。
//
// 2026-10-16(任务 #453):只有用户能断链。会话自己报 stopped 的,finish 路由记成 done;会话报 failed
// 的(扩展没连上、某一步卡住)也照样排下一段,连续两段零进展才停。内推的节奏由 App 定:当天的
// LinkedIn 邀请额度(src/apply/invite-budget.ts)用完后各段跳过内推条目去做海投;只剩内推条目时下一段
// 以 paused 挂到明天 0 点(options.notBefore)。链没跑完就停了(零进展 / 段数到顶)出一张待处理卡
// (src/apply/plan-alerts.ts);任何结束都推一条 ntfy。

// 按排名投(2026-11-02,用户:「找到互联网公司的天梯排名,从最大厂往最下一个个帮我投」):计划不按方向
// 配额,而是一张排好序的岗位清单(options.campaign.ids)。每段的 jobIds 取清单最前面的 2×chunk 个(定向
// 取件按给定顺序,src/apply/queue.ts),做满 chunk 份照常 finish;收工时把清单里已经有去向的(填好、
// 提交、归档、死链、出了待处理卡)去掉,剩下的接着排下一段——暂停、只有用户能断链,全跟方向计划一样。
// 零进展 = 本段一份没填好、清单也一个没少(连死链都没碰到,多半是会话根本没在干活)。
// 积压只算清单自己的卡(campaign.all,2026-11-03,用户选的):40 张旧的「点提交」卡让清单一份没填就暂停,
// 那些卡的标签页多半早没了;清单自己的 10 张卡标签页还开着,点完就接着投。

// How many of the list's next jobs a segment is handed: twice what it should fill, so a few dead
// links at the top of the list do not end the segment early.
export const CAMPAIGN_WINDOW_FACTOR = 2;

// The first segment's options for a ranked list (later ones are made in maybeContinueApplyRun).
export function campaignOptions(ids: number[], chunk: number = APPLY_CHUNK_SIZE, total: number = ids.length, all: number[] = ids): StartOptions {
  return { jobIds: ids.slice(0, chunk * CAMPAIGN_WINDOW_FACTOR), mode: "direct", chunk, campaign: { ids, total, all } };
}

function campaignOf(options: StartOptions): CampaignInfo | null {
  const c = options.campaign;
  if (!c || !Array.isArray(c.ids)) return null;
  const clean = (list: number[]) => list.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const ids = clean(c.ids);
  return { ids, total: Math.max(ids.length, Math.floor(Number(c.total) || 0)), all: Array.isArray(c.all) ? clean(c.all) : ids };
}

// The jobs a paused row's backlog is counted over: a ranked list's own, or (undefined) the account's.
function backlogJobs(rawOptions: string): number[] | undefined {
  try {
    return campaignOf(JSON.parse(rawOptions))?.all;
  } catch {
    return undefined;
  }
}

// The list's jobs that still have nowhere to go, in list order: what a targeted run would take
// (src/apply/queue.ts takeNextApplication), plus a row a session took and left half-filled when
// its run ended — the picker hands those out again once they are reclaimed. A row with the user's
// answers on it is the follow-up's business (src/apply/followup.ts), not the list's.
export function campaignLeft(db: DB, userId: string, ids: number[]): number[] {
  if (ids.length === 0) return [];
  const open = new Set(
    (
      db
        .prepare(
          `SELECT a.job_id FROM applications a JOIN jobs j ON j.id = a.job_id
           WHERE a.user_id = ? AND a.job_id IN (SELECT value FROM json_each(?)) AND j.loc_flag IS NULL AND a.needs_manual_reason IS NULL
             AND (a.status IN ('matched','referral_ready') OR (a.status = 'prepared' AND a.info_answers IS NULL
               AND NOT EXISTS (SELECT 1 FROM executor_runs r WHERE r.id = a.run_id AND r.status IN ('running','queued','paused'))))`
        )
        .all(userId, JSON.stringify(ids)) as { job_id: number }[]
    ).map((r) => r.job_id)
  );
  return ids.filter((id) => open.has(id));
}

// Safety valve on chain length, scaled to the plan: #449 planned 1530 jobs at 10 a segment, and a
// flat 30-segment cap would have ended it at 300. Twice the segments the plan needs, plus slack.
export const MIN_CHAIN_STEPS = 30;
export function maxChainSteps(planned: ModeCounts, chunk: number): number {
  const total = (planned.direct || 0) + (planned.referral || 0);
  return Math.max(MIN_CHAIN_STEPS, Math.ceil(total / Math.max(1, chunk)) * 2 + 10);
}
export const MAX_ZERO_PROGRESS_RUNS = 2; // two consecutive segments with nothing to show → stop

export interface PlanEntryLike {
  direction: string;
  count: number;
  mode?: string;
}

export interface ContinueDeps {
  startExecutor?: typeof startExecutor;
  hasLiveOrQueuedRun?: typeof hasLiveOrQueuedRun;
  // Where a resumed user_chrome segment's log file goes (tests point this at a temp dir).
  logDir?: string;
  // The run did not finish: its attended session was reaped mid-segment (server restart, child
  // crash — src/executor/attended.ts closeOutReapedSession). Kept for callers; a failed segment
  // chains on either way now (only the user's stop ends a chain).
  interrupted?: boolean;
  // ntfy when a chain ends (tests capture it).
  notify?: (title: string, body: string) => void;
  // Clock for a paused chain's notBefore (tests).
  now?: number;
}

export type ContinueResult =
  | { action: "none"; reason: string }
  | { action: "queued"; runId: number; channel: ExecutorChannel }
  | { action: "paused"; runId: number; unconfirmed: number; until?: string };

// Filled applications waiting on the user — each one is an open Chrome tab: the ones not decided
// on yet (a click on /apply), and the approved ones whose Submit the assistant was not allowed to
// click (a 「点提交」 card, 2026-10-22: the user clicks Submit in that tab). Approving, rejecting,
// 「我提交了」, a retry or a skip shrinks it. With jobIds, only those jobs' (a ranked list's).
export function unconfirmedCount(db: DB, userId: string, jobIds?: number[]): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) n FROM applications WHERE user_id = ? ${jobIds ? "AND job_id IN (SELECT value FROM json_each(?))" : ""}
           AND ((status = 'awaiting_confirm' AND confirm_decision IS NULL)
             OR (status = 'matched' AND needs_manual_reason LIKE '${SUBMIT_BLOCKED_PREFIX}%'))`
      )
      .get(userId, ...(jobIds ? [JSON.stringify(jobIds)] : [])) as { n: number }
  ).n;
}

interface ClaimedWithDirection extends ClaimedRow {
  direction: string | null;
}

// What is left of `plan` after run `runId`: each entry minus what the run achieved for that
// direction+mode. An entry the run claimed jobs for but achieved nothing on is dropped — the
// direction is exhausted, or blocked (LinkedIn's monthly invite quota, every page a dead link) —
// so the next segment does not burn its time on it again; an entry the run never reached is
// kept in full.
export function remainingPlan(
  db: DB,
  runId: number,
  plan: PlanEntryLike[]
): { remaining: PlanEntryLike[]; dropped: PlanEntryLike[]; own: ModeCounts } {
  const rows = db
    .prepare(
      `SELECT m.direction, a.status, a.confirm_decision, a.needs_manual_reason, a.pending_questions
       FROM applications a LEFT JOIN matches m ON m.user_id = a.user_id AND m.job_id = a.job_id WHERE a.run_id = ?`
    )
    .all(runId) as ClaimedWithDirection[];
  const results = rows.map((r) => ({ direction: r.direction, ...rowResult(r) }));
  const own = { direct: 0, referral: 0 };
  for (const r of results) if (r.achieved) own[r.mode] += 1;

  const remaining: PlanEntryLike[] = [];
  const dropped: PlanEntryLike[] = [];
  for (const e of plan) {
    const mode = e.mode === "referral" ? "referral" : "direct";
    const mine = results.filter((r) => r.direction === e.direction && r.mode === mode);
    const achieved = mine.filter((r) => r.achieved).length;
    const left = Math.max(0, Math.floor(Number(e.count) || 0)) - achieved;
    if (left <= 0) continue;
    if (mine.length > 0 && achieved === 0) {
      dropped.push({ direction: e.direction, count: left, mode });
      continue;
    }
    remaining.push({ direction: e.direction, count: left, mode });
  }
  return { remaining, dropped, own };
}

function chainOf(options: { chain?: ChainInfo }, runId: number): ChainInfo {
  return (
    options.chain ?? {
      root: runId,
      step: 1,
      planned: plannedCounts(options) ?? { direct: 0, referral: 0 },
      before: { direct: 0, referral: 0 },
      zeroRuns: 0,
    }
  );
}

function insertPausedRun(db: DB, userId: string, channel: ExecutorChannel, options: StartOptions, unconfirmed: number, live = false, why?: string): number {
  const summary =
    why ??
    (unconfirmed >= BACKLOG_PAUSE_AT
      ? `等你处理:${unconfirmed} 份填好的申请还没确认或还没点提交,降到 ${BACKLOG_RESUME_AT} 份以下自动继续`
      : live
        ? "等排在前面的任务做完再继续"
        : `等你处理:${unconfirmed} 份填好的申请还没确认或还没点提交,降到 ${BACKLOG_RESUME_AT} 份以下自动继续`);
  const r = db
    .prepare("INSERT INTO executor_runs (user_id, kind, status, channel, pid, options, summary) VALUES (?, 'apply', 'paused', ?, NULL, ?, ?)")
    .run(userId, channel, JSON.stringify(options), summary);
  return Number(r.lastInsertRowid);
}

// Called once an apply run has ended (finish route; headless exit handler; a reaped session).
// Decides whether the plan needs another segment and either queues it, parks it as 'paused'
// (behind the confirmation backlog, or until tomorrow when only referral entries are left and
// today's invite budget is spent), or ends the chain. Only a run the user stopped never chains
// on. The account is the run's own. Never throws — a bookkeeping failure must not turn a
// successful finish into an error.
export function maybeContinueApplyRun(db: DB, runId: number, deps: ContinueDeps = {}): ContinueResult {
  try {
    const run = db.prepare("SELECT user_id, kind, status, channel, options FROM executor_runs WHERE id = ?").get(runId) as
      | { user_id: string; kind: string; status: string; channel: string; options: string }
      | undefined;
    if (!run || run.kind !== "apply") return { action: "none", reason: "not an apply run" };
    if (run.status !== "done" && run.status !== "failed") return { action: "none", reason: `run ended as ${run.status}, chain stops` };
    const userId = run.user_id;
    let options: StartOptions & { chain?: ChainInfo } = {};
    try {
      options = JSON.parse(run.options);
    } catch {
      options = {};
    }
    const plan = Array.isArray(options.plan) ? (options.plan as PlanEntryLike[]) : [];
    const campaign = plan.length === 0 ? campaignOf(options) : null;
    if (plan.length === 0 && !campaign) return { action: "none", reason: "no plan to continue" };

    const chain = chainOf(options, runId);
    const { remaining, dropped, own } = remainingPlan(db, runId, plan);
    const left = campaign ? campaignLeft(db, userId, campaign.ids) : [];
    // Only referral entries left and no invites left today: nothing for a segment to do until
    // midnight. Not a zero-progress strike — the App is pacing, nothing is broken.
    const budget = remaining.length > 0 && remaining.every((e) => e.mode === "referral") ? inviteBudget(db, userId) : null;
    const waitForInvites = !!budget?.exhausted;
    const progressed = own.direct + own.referral > 0 || (campaign != null && left.length < campaign.ids.length);
    const zeroRuns = waitForInvites ? chain.zeroRuns : progressed ? 0 : chain.zeroRuns + 1;
    // The chain ends here: say why on the run's outcome (the board shows it next to 未完成) and
    // in the server log — task #133 ended with nothing but "未完成 · 海投 63/90" to go on.
    const endChain = (end: ChainEnd, reason: string): ContinueResult => {
      recordChainEnd(db, runId, end);
      console.log(`[apply continue] run #${runId} (chain #${chain.root} step ${chain.step}) ends: ${reason}`);
      notifyChainEnd(db, userId, chain, own, end, deps.notify);
      return { action: "none", reason };
    };
    const givenUp = (entries: PlanEntryLike[]): NonNullable<ChainEnd["dropped"]> =>
      entries.map((e) => ({ direction: e.direction, count: Math.max(0, Math.floor(Number(e.count) || 0)), mode: e.mode === "referral" ? "referral" : "direct" }));
    if (campaign ? left.length === 0 : remaining.length === 0) {
      return dropped.length > 0
        ? endChain({ reason: "exhausted", dropped: givenUp(dropped) }, `nothing left worth retrying: ${dropped.map((d) => `${d.direction}/${d.mode} ${d.count}`).join(", ")}`)
        : endChain({ reason: "done" }, campaign ? "ranked list finished" : "plan finished");
    }
    if (zeroRuns >= MAX_ZERO_PROGRESS_RUNS) {
      return endChain({ reason: "no_progress", dropped: givenUp([...dropped, ...remaining]) }, `no progress in ${zeroRuns} consecutive segments`);
    }
    const chunk = typeof options.chunk === "number" && options.chunk > 0 ? options.chunk : APPLY_CHUNK_SIZE;
    if (chain.step >= maxChainSteps(chain.planned, chunk))
      return endChain({ reason: "too_long", dropped: givenUp([...dropped, ...remaining]) }, `chain already ${chain.step} segments long`);

    const next: StartOptions = {
      resume: true, // submit whatever the user approved meanwhile before filling new ones
      ...(campaign
        ? campaignOptions(left, chunk, campaign.total, campaign.all)
        : { plan: remaining.map((e) => ({ direction: e.direction, count: e.count, mode: e.mode === "referral" ? "referral" : "direct" })), chunk }),
      chain: {
        root: chain.root,
        step: chain.step + 1,
        planned: chain.planned,
        before: { direct: chain.before.direct + own.direct, referral: chain.before.referral + own.referral },
        zeroRuns,
      },
    } as StartOptions;
    const channel = (run.channel === "headless" ? "headless" : "user_chrome") as ExecutorChannel;
    const unconfirmed = unconfirmedCount(db, userId, campaign?.all);
    if (waitForInvites && budget) {
      const until = budget.resetsAt;
      const why = budget.cooldownUntil
        ? "LinkedIn 今天提示放慢,内推明天 0 点后自动继续"
        : `今天的 LinkedIn 邀请额度(${budget.limit} 条)用完了,内推明天 0 点后自动继续`;
      const id = insertPausedRun(db, userId, channel, { ...next, notBefore: until }, unconfirmed, false, why);
      console.log(`[apply continue] run #${runId} (chain #${chain.root}): only referral entries left, invite budget spent → paused #${id} until ${until}`);
      return { action: "paused", runId: id, unconfirmed, until };
    }
    // Another task of the account being on is no reason to wait on the Chrome channel: tasks run
    // side by side there, each in its own session, and a queued segment simply waits for a free
    // one (2026-09-30). A headless segment is a process spawned right now against the one
    // browser profile, so it still waits for the one ahead of it.
    const live = channel === "headless" && (deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun)(db, userId, "apply");
    if (unconfirmed >= BACKLOG_PAUSE_AT || live) {
      return { action: "paused", runId: insertPausedRun(db, userId, channel, next, unconfirmed, live), unconfirmed };
    }
    const runnerDeps = { ...(deps.logDir ? { logDir: deps.logDir } : {}), ...(channel === "user_chrome" ? { queueBehind: true } : {}) };
    const started = (deps.startExecutor ?? startExecutor)(db, userId, "apply", next, runnerDeps, channel);
    return { action: "queued", runId: started.id, channel };
  } catch (e) {
    console.error("[apply continue] run", runId, e);
    return { action: "none", reason: `error: ${String(e)}` };
  }
}

// Called whenever the account's confirmation backlog may have shrunk (approve/reject on /apply)
// or a session freed up (any apply run finished): if a chain is parked as 'paused' and the
// backlog is low enough, hand it to a session. A user_chrome row simply becomes 'queued' (same
// id, so the card keeps its identity) — every parked one at once, since tasks run side by side
// there (2026-09-30); the result names the newest. A headless row spawns a fresh run and the
// placeholder is closed out, one at a time and only while no other apply run is on.
export function resumePausedChainIfReady(db: DB, userId: string, deps: ContinueDeps = {}): ContinueResult {
  try {
    const now = deps.now ?? Date.now();
    const all = db
      .prepare("SELECT id, channel, options, log_path FROM executor_runs WHERE user_id = ? AND kind = 'apply' AND status = 'paused' ORDER BY id DESC")
      .all(userId) as { id: number; channel: string; options: string; log_path: string | null }[];
    if (all.length === 0) return { action: "none", reason: "no paused chain" };
    // A chain parked until tomorrow (invite budget spent) waits for its time.
    const parked = all.filter((p) => {
      try {
        const nb = (JSON.parse(p.options) as { notBefore?: string }).notBefore;
        return !nb || Date.parse(nb) <= now;
      } catch {
        return true;
      }
    });
    if (parked.length === 0) return { action: "none", reason: "paused chain waits for tomorrow" };
    const backlog = (p: { options: string }): number => unconfirmedCount(db, userId, backlogJobs(p.options));
    const ready = parked.filter((p) => backlog(p) <= BACKLOG_RESUME_AT);
    if (ready.length === 0) return { action: "none", reason: `backlog still ${backlog(parked[0])} unconfirmed` };

    const attended = ready.filter((p) => p.channel !== "headless");
    if (attended.length > 0) {
      const logDir = deps.logDir ?? path.join(dataDir(), "executor-logs");
      fs.mkdirSync(logDir, { recursive: true });
      let first: number | null = null;
      for (const paused of attended) {
        const logPath = paused.log_path ?? path.join(logDir, `run-${paused.id}.log`);
        fs.closeSync(fs.openSync(logPath, "a"));
        const flipped = db
          .prepare("UPDATE executor_runs SET status = 'queued', started_at = datetime('now'), log_path = ?, summary = NULL WHERE id = ? AND status = 'paused'")
          .run(logPath, paused.id);
        if (flipped.changes > 0) first ??= paused.id;
      }
      if (first == null) return { action: "none", reason: "paused row changed underneath" };
      return { action: "queued", runId: first, channel: "user_chrome" };
    }
    if ((deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun)(db, userId, "apply")) return { action: "none", reason: "another apply run is live or queued" };
    const paused = ready[0];
    let options: StartOptions = {};
    try {
      options = JSON.parse(paused.options);
    } catch {
      options = {};
    }
    const started = (deps.startExecutor ?? startExecutor)(db, userId, "apply", options, deps.logDir ? { logDir: deps.logDir } : {}, "headless");
    db.prepare("UPDATE executor_runs SET status = 'done', summary = ?, ended_at = datetime('now') WHERE id = ?").run(
      `已由任务 #${started.id} 接续`,
      paused.id
    );
    return { action: "queued", runId: started.id, channel: "headless" };
  } catch (e) {
    console.error("[apply continue] resume", e);
    return { action: "none", reason: `error: ${String(e)}` };
  }
}

// "海投 63/90 · 内推 12/30" for a push: what the whole chain got done against its plan.
export function chainProgressText(lang: "zh" | "en", planned: ModeCounts, achieved: ModeCounts): string {
  const t = messages[lang].notify.plan;
  const parts: string[] = [];
  if (planned.direct > 0) parts.push(t.direct(achieved.direct, planned.direct));
  if (planned.referral > 0) parts.push(t.referral(achieved.referral, planned.referral));
  return parts.join(" · ");
}

// Every chain end gets a push; the ones that need the user (no progress, too long) also leave a
// 待处理 card (src/apply/plan-alerts.ts reads the recorded end).
function notifyChainEnd(db: DB, userId: string, chain: ChainInfo, own: ModeCounts, end: ChainEnd, push?: (title: string, body: string) => void): void {
  try {
    const lang = serverLang();
    const t = messages[lang].notify.plan;
    const achieved = { direct: chain.before.direct + own.direct, referral: chain.before.referral + own.referral };
    const progress = chainProgressText(lang, chain.planned, achieved);
    const [title, body] =
      end.reason === "done"
        ? [t.doneTitle(chain.root), t.doneBody(progress)]
        : end.reason === "exhausted"
          ? [t.exhaustedTitle(chain.root), t.exhaustedBody(progress)]
          : [t.stuckTitle(chain.root), t.stuckBody(progress, end.reason === "too_long" ? t.tooLong : t.noProgress)];
    const send = push ?? ((a: string, b: string) => void notify(a, b, { priority: end.reason === "done" || end.reason === "exhausted" ? "default" : "high", account: { db, userId } }));
    send(title, body);
  } catch (e) {
    console.error("[apply continue] chain-end notify failed", e);
  }
}

// The dispatcher tick: a chain parked until tomorrow (invite budget) has no approval or finish to
// wake it, so every account with a paused chain gets a look each tick.
export function resumeDuePausedChains(db: DB, deps: ContinueDeps = {}): ContinueResult[] {
  const users = db.prepare("SELECT DISTINCT user_id FROM executor_runs WHERE kind = 'apply' AND status = 'paused'").all() as { user_id: string }[];
  return users.map((u) => resumePausedChainIfReady(db, u.user_id, deps)).filter((r) => r.action !== "none");
}
