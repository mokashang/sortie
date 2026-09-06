import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";
import { locFlag } from "@/scanner/location-filter";

// Workday 站点自己用的 JSON 接口(CXS,未文档化但所有租户一致)。列表不含正文,新岗再拉一次详情。
// 关键词逐个搜(接口不支持 OR),按 externalPath 去重。
const KEYWORDS = ["new grad", "new college grad", "graduate", "intern", "early career", "university", "entry level", "campus"];
const PAGE = 20;
interface Posting { title: string; externalPath: string; locationsText?: string; postedOn?: string; }
interface Detail { jobPostingInfo?: { jobDescription?: string; startDate?: string; location?: string; additionalLocations?: string[] } }

export async function fetchWorkday(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const [tenantWd, site] = board.ident.split("/");
  const [tenant, wd] = (tenantWd ?? "").split(".");
  if (!tenant || !wd || !site) throw new Error(`workday ${board.ident}: bad ident`);
  const base = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const cxs = `${base}/wday/cxs/${tenant}/${site}`;
  const maxPages = ctx.depth === "core" ? 15 : 5;   // 每词最多 300 / 100 条
  const seen = new Map<string, Posting>();
  for (const kw of KEYWORDS) {
    for (let page = 0; page < maxPages; page++) {
      const res = await ctx.fetcher(`${cxs}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText: kw }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`workday ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { jobPostings?: Posting[] };
      const posts = data.jobPostings ?? [];
      for (const p of posts) if (p.externalPath && !seen.has(p.externalPath)) seen.set(p.externalPath, p);
      if (posts.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const [path, p] of seen) {
    if (!isEntryLevelTitle(p.title)) continue;
    if (locFlag(p.locationsText ?? null)) continue;            // 明确非美国:不拉详情、不入库
    const applyUrl = `${base}/${site}${path}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "", postedAt: string | null = null, location: string | null = p.locationsText ?? null;
    try {
      const d = await ctx.fetcher(`${cxs}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const info = ((await d.json()) as Detail).jobPostingInfo ?? {};
        jdText = htmlToText(info.jobDescription ?? "");
        postedAt = info.startDate ?? null;
        if (info.location) location = [info.location, ...(info.additionalLocations ?? [])].join("; ");
      }
    } catch { /* 详情失败:以空正文入库,jd_review 兜底 */ }
    out.push({ company: board.company ?? tenant, title: p.title, location, jdText, applyUrl, source: "workday", ats: "workday", postedAt });
  }
  return out;
}
