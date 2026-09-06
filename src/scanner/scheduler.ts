import { DB, logEvent } from "@/lib/db";
import { Family } from "@/scanner/board-key";
import { BoardRow, SeedEntry, Tier, dueBoards, markBoardResult, mergeBoardMeta, syncBoardsSeed } from "@/scanner/boards";
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
  now?: Date; budgetBoards?: number; budgetMs?: number; families?: Family[]; tiers?: Tier[]; keys?: string[];
  registry?: Registry; fetcher?: Fetcher; seed?: SeedEntry[] | null; rand?: () => number; localHour?: number;
}
export interface TickSummary {
  boards: number; inserted: number; upgraded: number; duplicates: number; visaSkipped: number; locSkipped: number;
  byFamily: Record<string, { boards: number; inserted: number; errors: number }>;
  errors: { key: string; error: string }[]; durationMs: number;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let seedSynced = false;

export async function runTick(db: DB, opts: TickOptions = {}): Promise<TickSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const registry = opts.registry ?? LIVE_REGISTRY;
  const fetcher = opts.fetcher ?? fetch;
  // 种子每个进程只同步一次(seed=null 表示测试里明确不要同步;传入 seed 则每次都同步)。
  if (opts.seed !== null && (opts.seed || !seedSynced)) {
    syncBoardsSeed(db, opts.seed ?? DEFAULT_SEED);
    if (!opts.seed) seedSynced = true;
  }
  const due = dueBoards(db, { now, limit: opts.budgetBoards ?? 300, families: opts.families, tiers: opts.tiers, keys: opts.keys, localHour: opts.localHour ?? now.getHours() });
  const summary: TickSummary = { boards: 0, inserted: 0, upgraded: 0, duplicates: 0, visaSkipped: 0, locSkipped: 0, byFamily: {}, errors: [], durationMs: 0 };
  const knownStmt = db.prepare("SELECT 1 FROM jobs WHERE apply_url = ?");
  const isKnownUrl = (u: string) => !!knownStmt.get(u);
  const deadline = started + (opts.budgetMs ?? 90_000);
  const groups = new Map<Family, BoardRow[]>();
  for (const b of due) groups.set(b.family, [...(groups.get(b.family) ?? []), b]);

  const runBoard = async (b: BoardRow, cfg: FamilyConfig) => {
    const fam = (summary.byFamily[b.family] ??= { boards: 0, inserted: 0, errors: 0 });
    fam.boards++; summary.boards++;
    try {
      let rows = await cfg.fetch(b, { fetcher, depth: b.tier === "core" ? "core" : "longtail", isKnownUrl, now, setMeta: (p) => mergeBoardMeta(db, b.key, p) });
      // 工程标题门只对非精选来源生效:种子公司和清单不设门(spec §2)。
      if (cfg.gated && b.origin !== "seed") rows = rows.filter((r) => isEngineeringTitle(r.title));
      const s = upsertJobs(db, rows, { boardKey: b.key });
      summary.inserted += s.inserted; summary.upgraded += s.upgraded; summary.duplicates += s.duplicates;
      summary.visaSkipped += s.visaSkipped; summary.locSkipped += s.locSkipped; fam.inserted += s.inserted;
      for (const e of s.errors) summary.errors.push({ key: b.key, error: e.error });
      markBoardResult(db, b.key, { ok: true, now, rand: opts.rand });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const st = msg.match(/HTTP (\d{3})/);
      markBoardResult(db, b.key, { ok: false, error: msg, httpStatus: st ? Number(st[1]) : null, now, rand: opts.rand });
      fam.errors++; summary.errors.push({ key: b.key, error: msg });
    }
  };

  await Promise.all([...groups.entries()].map(async ([family, boards]) => {
    const cfg = registry[family];
    if (!cfg) return;
    const queue = [...boards];
    const worker = async () => {
      while (queue.length && Date.now() < deadline) {
        await runBoard(queue.shift()!, cfg);
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
  return runTick(db, { ...opts, budgetBoards: opts.budgetBoards ?? 5000, budgetMs: opts.budgetMs ?? 10 * 60_000 });
}
