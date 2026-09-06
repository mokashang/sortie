import { BoardRow } from "@/scanner/boards";
import { Registry } from "@/scanner/sources/types";
import { fetchGreenhouse } from "@/scanner/sources/greenhouse";
import { fetchLever } from "@/scanner/sources/lever";
import { fetchAshby } from "@/scanner/sources/ashby";
import { fetchWorkday } from "@/scanner/sources/workday";

export type { FetchCtx, BoardFetcher, FamilyConfig, Registry } from "@/scanner/sources/types";

const name = (b: BoardRow) => b.company ?? b.ident;

// family → 适配器 + 礼貌参数。谁失败只影响谁(调度器逐板块 try/catch)。
export const LIVE_REGISTRY: Registry = {
  greenhouse: { fetch: (b, c) => fetchGreenhouse(b.ident, name(b), c.fetcher), concurrency: 8, minGapMs: 0, gated: true },
  lever: { fetch: (b, c) => fetchLever(b.ident, name(b), c.fetcher), concurrency: 8, minGapMs: 0, gated: true },
  ashby: { fetch: (b, c) => fetchAshby(b.ident, name(b), c.fetcher), concurrency: 8, minGapMs: 0, gated: true },
  workday: { fetch: fetchWorkday, concurrency: 4, minGapMs: 200, gated: true },
};
