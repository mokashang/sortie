import { FetchCtx } from "@/scanner/sources/types";

// 适配器共用的小工具:板块截止时刻、标题门、关键词轮换、带 Retry-After 的 HTTP 错误。

// 过了本板块的截止时刻:不再发新请求,带着已经拿到的返回(调度器给的 ctx.deadline)。
export function pastDeadline(ctx: FetchCtx): boolean {
  return ctx.deadline !== undefined && Date.now() >= ctx.deadline;
}

// 调度器的工程标题门放不放行(没有门 = 都要)。门外的岗拉了详情也入不了库,下次还得再拉一遍。
export function wanted(ctx: FetchCtx, title: string): boolean {
  return !ctx.wantTitle || ctx.wantTitle(title);
}

// 关键词按「第几分钟」轮换起点:截止时刻打断时,下一次轮询先搜别的词,不会永远只搜到前几个。
export function rotate<T>(xs: readonly T[], now: Date): T[] {
  if (xs.length === 0) return [];
  const k = Math.floor(now.getTime() / 60_000) % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
}

// Retry-After 可以是秒数,也可以是 HTTP 日期。
export function retryAfterSec(h: string | null, now: number = Date.now()): number | null {
  if (!h) return null;
  if (/^\d+$/.test(h.trim())) return Number(h.trim());
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((t - now) / 1000));
}

// 「<label>: HTTP 429 (retry-after 23824s)」—— 调度器从消息里读状态码和 Retry-After。
export function httpError(label: string, res: Response): Error {
  const ra = retryAfterSec(res.headers.get("retry-after"));
  return new Error(`${label}: HTTP ${res.status}${ra !== null ? ` (retry-after ${ra}s)` : ""}`);
}

// 读 JSON;对方回的是网页(Workday 维护时 200 + HTML)就给一句看得懂的错误,而不是 JSON.parse 的原话。
// 消息里刻意不写「HTTP nnn」:这不是对方给的错误状态,不该进状态码规则。
export async function readJson<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const ct = (res.headers.get("content-type") ?? "").split(";")[0] || "no content-type";
    throw new Error(`${label}: response is not JSON (${ct})`);
  }
}
