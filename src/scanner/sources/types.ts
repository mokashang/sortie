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
  // 本板块的截止时刻(epoch ms)。过了就不再发新请求、带着已拿到的返回;没来得及拉详情的新岗这次不返回,
  // 下次轮询还是「没入库」,会再拉。第一个列表请求总会发出去。
  deadline?: number;
  // 调度器的工程标题门(只对非精选来源)。门外的岗不拉详情:反正入不了库,拉了下次还得再拉。
  wantTitle?: (title: string) => boolean;
  truncated?: () => void;                 // 适配器因截止时刻提前收手时告诉调度器(记进 scan_tick 事件)
  // 板块搬家了(Workday 租户换了 pod):这次已经从新地址取数;调度器登记新板块、把老板块静音(可撤销)。
  moved?: (newKey: string) => void;
}
export type BoardFetcher = (board: BoardRow, ctx: FetchCtx) => Promise<RawJob[]>;
export interface FamilyConfig {
  fetch: BoardFetcher;
  concurrency: number;   // 同一 family 最多同时开几个连接
  minGapMs: number;      // 同一 worker 两个板块之间的间隔
  gated: boolean;        // 工程标题门是否适用(对 origin ≠ seed 的板块)
  // 整个 family 共用一个接口主机、一份限流(Workable 的 apply.workable.com):一个板块吃到 429,
  // 这一跳里同 family 的其余板块不再问,并且整个 family 歇到 Retry-After(没给就 1 小时)。
  sharedHost?: boolean;
  // 一次轮询本来就要好几分钟、刻意慢慢问的板块(LinkedIn 游客接口):跳不等它,在后台按自己的节奏跑完,
  // 不受跳的截止时刻约束(见 scheduler.ts 的 ownPaceRuns)。
  ownPace?: boolean;
}
export type Registry = Partial<Record<Family, FamilyConfig>>;
