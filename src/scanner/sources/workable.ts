import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";
import { httpError, readJson } from "@/scanner/sources/util";

// Workable 公开的 widget 接口(公司官网嵌职位列表用的那个):一次 GET 拿全部岗位,details=true 连正文
// (description 已含 Requirements / Benefits)一起给,不翻页、不拉详情。
// 2026-10-21 起不用 v3 列表(POST /api/v3/accounts/<acct>/jobs)+ v2 详情:v3 这个接口自己有限流,
// 每天问到 40–110 个板块就回 429「rate_limit」并 Retry-After 整整 24 小时;被封的同一时刻、同一台机器上
// widget 接口照常 200。
interface WkLocation { country?: string; countryCode?: string; city?: string; region?: string; hidden?: boolean; }
interface WkJob {
  title: string; shortcode: string; telecommuting?: boolean; published_on?: string; created_at?: string;
  country?: string; city?: string; state?: string; locations?: WkLocation[]; description?: string;
}

const isUs = (l: WkLocation) => l.countryCode === "US" || l.country === "United States";
const place = (l: WkLocation) => [l.city, l.region, l.country].filter(Boolean).join(", ");

export async function fetchWorkable(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const acct = board.ident;
  const res = await ctx.fetcher(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(acct)}?details=true`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw httpError(`workable ${acct}`, res);
  const data = await readJson<{ jobs?: WkJob[] }>(res, `workable ${acct}`);
  const out: RawJob[] = [];
  for (const j of data.jobs ?? []) {
    const locs = (j.locations ?? []).filter((l) => !l.hidden);
    const usLocs = locs.filter(isUs);
    const noCountry = locs.length === 0 && !j.country;
    const us = usLocs.length > 0 || j.country === "United States" || (noCountry && !!j.telecommuting);
    if (!us || !isEntryLevelTitle(j.title)) continue;
    // 和 v3 时代同一个链接格式:已入库的岗靠它认出来(跳过,不重复入库),板块也靠它解析。
    const applyUrl = `https://apply.workable.com/${acct}/j/${j.shortcode}/`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    // 地点和 v3 一样取主地点「城市, 州, 国家」(指纹里有地点);主地点不在美国时才换成第一个美国地点。
    const primary = [j.city, j.state, j.country].filter(Boolean).join(", ");
    const location = (j.country === "United States" || !usLocs.length ? primary : place(usLocs[0])) || (j.telecommuting ? "Remote, US" : null);
    out.push({
      company: board.company ?? acct, title: j.title, location, jdText: htmlToText(j.description ?? ""),
      applyUrl, source: "workable", ats: "workable", postedAt: j.published_on ?? j.created_at ?? null,
    });
  }
  return out;
}
