import { DB, logEvent } from "@/lib/db";
import { Family } from "@/scanner/board-key";
import { BoardRow, SeedEntry, Tier, discoverBoardsFromJobs, dueBoards, iso, markBoardResult, mergeBoardMeta, muteBoard, syncBoardsSeed, upsertBoards } from "@/scanner/boards";
import { LIVE_REGISTRY } from "@/scanner/sources/index";
import { FamilyConfig, Registry } from "@/scanner/sources/types";
import { upsertJobs } from "@/scanner/upsert";
import { isEngineeringTitle } from "@/scanner/entry-level";
import { Fetcher } from "@/scanner/types";
import seedJson from "../../config/boards.seed.json";

export const DEFAULT_SEED = seedJson as SeedEntry[];

// 每分钟一跳的调度器(spec 2026-09-06 §3.1):挑到期板块,按 family 分组并发问,统一入库,回写板块状态。
// 一次最多 budgetBoards 个板块或 budgetMs 毫秒,处理不完的下一分钟接着来。
export interface TickOptions {
  now?: Date; budgetBoards?: number; budgetMs?: number; perFamily?: number; inlineOwnPace?: boolean; families?: Family[]; tiers?: Tier[]; keys?: string[];
  registry?: Registry; fetcher?: Fetcher; seed?: SeedEntry[] | null; rand?: () => number; localHour?: number;
}
export interface TickSummary {
  boards: number; inserted: number; upgraded: number; duplicates: number; visaSkipped: number; locSkipped: number;
  // truncated = 因截止时刻提前收手的板块数;pausedUntil = 共用主机的 family 吃到 429 后歇到什么时候(都只在发生时出现)
  byFamily: Record<string, { boards: number; inserted: number; errors: number; truncated?: number; pausedUntil?: string; moved?: number }>;
  errors: { key: string; error: string }[]; durationMs: number;
  ownPaceStarted?: string[];   // 这一跳在后台开跑的自己节奏的板块(结果另记 scan_board 事件)
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const parseDirections = (s: string | null): string[] | undefined => { try { const v = s ? JSON.parse(s) : null; return Array.isArray(v) ? v : undefined; } catch { return undefined; } };

// 一跳的预算只管「还挑不挑新板块」;已经开始的板块由截止时刻收住:跳的截止时刻,但至少留给它这么久
// (第 89 秒才开始的板块也要能把列表问完)。所以一跳最长约 预算 + 20 秒 + 一个请求的超时。
// 2026-10-21 之前没有这一层:一个 CVS 量级的 Workday 租户能把一跳拖到十几分钟。
export const BOARD_MIN_MS = 20_000;

// 共用主机的 family(Workable)吃到 429 后整个歇着,歇到 Retry-After(夹在 1 分钟 – 24 小时之间,没给就 1 小时)。
// 只存在进程内存:重启后最多再试一个板块,就又歇上了。挂 globalThis,开发模式热重载也不丢。
const RATE_LIMIT_PAUSE_DEFAULT_MS = 3600_000;
const clampRetryMs = (ms: number) => Math.min(24 * 3600_000, Math.max(60_000, ms));
const familyPauses: Map<Family, number> = ((globalThis as { __sortieFamilyPauses?: Map<Family, number> }).__sortieFamilyPauses ??= new Map());
export function familyPausedUntil(family: Family, now: Date = new Date()): Date | null {
  const t = familyPauses.get(family);
  return t !== undefined && t > now.getTime() ? new Date(t) : null;
}
export function clearFamilyPauses(): void { familyPauses.clear(); }

// 自己节奏的 family(FamilyConfig.ownPace,目前是 LinkedIn 游客接口:一次轮询七十来页搜索 + 最多 80 页详情,
// 每页之间停 3 秒,约 8 分钟,一周带来两百来个岗):跳不等它,在后台跑完再记账(事件 scan_board),
// 同一个板块同时只跑一个。以前它在跳里跑,整跳连同所有别的来源一起等 8 分钟。
// 进程级登记(挂 globalThis):不同路由各有一份模块,也不会同时开两个。
const ownPaceRuns: Map<string, Promise<void>> = ((globalThis as { __sortieOwnPaceRuns?: Map<string, Promise<void>> }).__sortieOwnPaceRuns ??= new Map());
export function ownPaceRunning(): string[] { return [...ownPaceRuns.keys()]; }
export async function waitForOwnPaceRuns(): Promise<void> { await Promise.all([...ownPaceRuns.values()]); }

// Node 自带 fetch 的 UA 是 "node",字节等站点对非浏览器 UA 直接 405;统一给所有适配器一个浏览器 UA
// (jd-fetch.ts 同款),适配器自己设了的头不覆盖。
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
export const browserFetch: Fetcher = (url, init) => {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("user-agent")) headers.set("user-agent", BROWSER_UA);
  if (!headers.has("accept-language")) headers.set("accept-language", "en-US,en;q=0.9");
  return fetch(url, { ...init, headers });
};
let registrySynced = false;

export async function runTick(db: DB, opts: TickOptions = {}): Promise<TickSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const registry = opts.registry ?? LIVE_REGISTRY;
  const fetcher = opts.fetcher ?? browserFetch;
  // 种子每个进程只同步一次(seed=null 表示测试里明确不要同步;传入 seed 则每次都同步)。同步完顺手补登
  // 岗位链接里出现过、还没登记的板块(只走索引,~10 ms);此后新板块由 upsertJobs 随到随登。
  if (opts.seed !== null && (opts.seed || !registrySynced)) {
    syncBoardsSeed(db, opts.seed ?? DEFAULT_SEED);
    discoverBoardsFromJobs(db, { now, rand: opts.rand });
    if (!opts.seed) registrySynced = true;
  }
  const paused = [...familyPauses.keys()].filter((f) => familyPausedUntil(f, now));
  const due = dueBoards(db, { now, limit: opts.budgetBoards ?? 300, perFamily: opts.perFamily, families: opts.families, skipFamilies: paused, tiers: opts.tiers, keys: opts.keys, localHour: opts.localHour ?? now.getHours() });
  const emptySummary = (): TickSummary => ({ boards: 0, inserted: 0, upgraded: 0, duplicates: 0, visaSkipped: 0, locSkipped: 0, byFamily: {}, errors: [], durationMs: 0 });
  const summary = emptySummary();
  const knownStmt = db.prepare("SELECT 1 FROM jobs WHERE apply_url = ?");
  const isKnownUrl = (u: string) => !!knownStmt.get(u);
  const deadline = started + (opts.budgetMs ?? 90_000);
  const groups = new Map<Family, BoardRow[]>();
  for (const b of due) groups.set(b.family, [...(groups.get(b.family) ?? []), b]);

  const stopped = new Set<Family>();   // 这一跳里吃到 429 的共用主机 family:不再挑它的板块
  // boardDeadline 为 undefined = 不限时(自己节奏的板块)。
  const runBoard = async (b: BoardRow, cfg: FamilyConfig, summary: TickSummary, boardDeadline: number | undefined) => {
    const fam = (summary.byFamily[b.family] ??= { boards: 0, inserted: 0, errors: 0 });
    fam.boards++; summary.boards++;
    // 工程标题门只对非精选来源生效:种子公司和清单不设门(spec §2)。门也交给适配器,门外的岗不拉详情。
    const gate = cfg.gated && b.origin !== "seed";
    let cut = false;
    let movedTo: string | null = null;
    try {
      let rows = await cfg.fetch(b, {
        fetcher, depth: b.tier === "core" ? "core" : "longtail", isKnownUrl, now, setMeta: (p) => mergeBoardMeta(db, b.key, p),
        deadline: boardDeadline, wantTitle: gate ? isEngineeringTitle : undefined,
        truncated: () => { cut = true; fam.truncated = (fam.truncated ?? 0) + 1; },
        moved: (k) => { movedTo = k; },
      });
      if (gate) rows = rows.filter((r) => isEngineeringTitle(r.title));
      // 搬家:先按老板块的身份登记新板块(入库时按链接自动登记的话会丢掉 origin / 层级),再入库。
      if (movedTo) upsertBoards(db, [{ key: movedTo, company: b.company, origin: b.origin, tier: b.tier === "muted" ? undefined : b.tier, directions: parseDirections(b.directions) }]);
      const s = upsertJobs(db, rows, { boardKey: movedTo ?? b.key, now });
      summary.inserted += s.inserted; summary.upgraded += s.upgraded; summary.duplicates += s.duplicates;
      summary.visaSkipped += s.visaSkipped; summary.locSkipped += s.locSkipped; fam.inserted += s.inserted;
      for (const e of s.errors) summary.errors.push({ key: b.key, error: e.error });
      if (movedTo) {
        markBoardResult(db, movedTo, { ok: true, truncated: cut, now, rand: opts.rand });
        muteBoard(db, b.key, `moved to ${movedTo}`);           // 记 board_retier;来源页可以改回
        fam.moved = (fam.moved ?? 0) + 1;
      }
      markBoardResult(db, b.key, { ok: true, truncated: cut, now, rand: opts.rand });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const st = msg.match(/HTTP (\d{3})/);
      const httpStatus = st ? Number(st[1]) : null;
      const ra = msg.match(/retry-after (\d+)s/);
      const retryAfterMs = httpStatus === 429 && ra ? clampRetryMs(Number(ra[1]) * 1000) : null;
      markBoardResult(db, b.key, { ok: false, error: msg, httpStatus, retryAfterMs, now, rand: opts.rand });
      fam.errors++; summary.errors.push({ key: b.key, error: msg });
      if (httpStatus === 429 && cfg.sharedHost) {
        // 同一个接口、同一份限流:其余板块问了也是 429,还会把它们一起推到明天的同一秒(2026-10 的 Workable 就是这样,
        // 每天 06:2x 有 61 个板块一起撞墙)。这一跳停下,整个 family 歇到 Retry-After。
        stopped.add(b.family);
        const until = now.getTime() + (retryAfterMs ?? RATE_LIMIT_PAUSE_DEFAULT_MS);
        familyPauses.set(b.family, Math.max(familyPauses.get(b.family) ?? 0, until));
        fam.pausedUntil = iso(new Date(familyPauses.get(b.family)!));
      }
    }
  };

  await Promise.all([...groups.entries()].map(async ([family, boards]) => {
    const cfg = registry[family];
    if (!cfg) return;
    if (cfg.ownPace && !opts.inlineOwnPace) {
      for (const b of boards) {
        if (ownPaceRuns.has(b.key)) continue;              // 上一次还没跑完
        const own = emptySummary();
        const t0 = Date.now();
        const run = runBoard(b, cfg, own, undefined)
          .then(() => { own.durationMs = Date.now() - t0; logEvent(db, "scan_board", { entity: "scanner", payload: { key: b.key, ...own } }); })
          .catch((e) => console.error("[scan board]", b.key, e))
          .finally(() => { ownPaceRuns.delete(b.key); });
        ownPaceRuns.set(b.key, run);
        (summary.ownPaceStarted ??= []).push(b.key);
      }
      return;
    }
    const queue = cfg.ownPace ? boards.filter((b) => !ownPaceRuns.has(b.key)) : [...boards];   // 后台那一次还在跑就不再开
    const worker = async () => {
      while (queue.length && Date.now() < deadline && !stopped.has(family)) {
        await runBoard(queue.shift()!, cfg, summary, Math.max(deadline, Date.now() + BOARD_MIN_MS));
        if (cfg.minGapMs) await sleep(cfg.minGapMs);
      }
    };
    await Promise.all(Array.from({ length: Math.min(cfg.concurrency, queue.length) }, worker));
  }));

  summary.durationMs = Date.now() - started;
  logEvent(db, "scan_tick", { entity: "scanner", payload: summary });
  return summary;
}

// 把目标板块标成到期后跑一次大预算 tick(「立即扫描」、来源页的「问一次」、脚本都用它)。
export async function runSweep(db: DB, opts: TickOptions = {}): Promise<TickSummary> {
  const conds = ["tier <> 'muted'"];
  const params: unknown[] = [];
  const inList = (col: string, vals?: string[]) => { if (vals?.length) { conds.push(`${col} IN (${vals.map(() => "?").join(",")})`); params.push(...vals); } };
  inList("tier", opts.tiers); inList("family", opts.families); inList("key", opts.keys);
  db.prepare(`UPDATE boards SET next_due_at = NULL WHERE ${conds.join(" AND ")}`).run(...params);
  // 「立即扫描」要的是全部问一遍:不设每个 family 的名额上限。
  const budgetBoards = opts.budgetBoards ?? 5000;
  // 自己节奏的板块也当场跑完(「问一次」要看到结果)。
  return runTick(db, { ...opts, budgetBoards, perFamily: opts.perFamily ?? budgetBoards, inlineOwnPace: opts.inlineOwnPace ?? true, budgetMs: opts.budgetMs ?? 10 * 60_000 });
}
