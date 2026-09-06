import { Fetcher, RawJob } from "@/scanner/types";
import { Family } from "@/scanner/board-key";
import { BoardRow } from "@/scanner/boards";

// 适配器统一接口:给我一个板块,还你一批岗。适配器只依赖注入的 fetcher,不读 DB。
export interface FetchCtx {
  fetcher: Fetcher;
  depth: "core" | "longtail";            // 翻页深度:核心公司翻得深,长尾翻得浅
  isKnownUrl: (url: string) => boolean;   // 已入库的岗不再拉详情(列表 + 详情两步的适配器用)
  now: Date;
  setMeta?: (patch: Record<string, unknown>) => void; // 适配器回写 boards.meta(如清单 ETag)
  sleep?: (ms: number) => Promise<void>;  // 限速用;测试注入空函数
}
export type BoardFetcher = (board: BoardRow, ctx: FetchCtx) => Promise<RawJob[]>;
export interface FamilyConfig {
  fetch: BoardFetcher;
  concurrency: number;   // 同一 family 最多同时开几个连接
  minGapMs: number;      // 同一 worker 两个板块之间的间隔
  gated: boolean;        // 工程标题门是否适用(对 origin ≠ seed 的板块)
}
export type Registry = Partial<Record<Family, FamilyConfig>>;
