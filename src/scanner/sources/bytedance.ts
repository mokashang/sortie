import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// 字节 / TikTok 共用一个搜索接口,靠 website-path 头 + portal_type 切门户。列表自带正文与要求。
const PORTALS: Record<string, { path: string; portal: number; company: string; url: (id: string) => string }> = {
  tiktok: { path: "tiktok", portal: 4, company: "TikTok", url: (id) => `https://lifeattiktok.com/search/${id}` },
  bytedance: { path: "bytedance", portal: 6, company: "ByteDance", url: (id) => `https://jobs.bytedance.com/en/position/${id}/detail` },
};
const KEYWORDS = ["graduate", "intern", "new grad", "campus"];
const PAGE = 50, MAX_OFFSET = 400;
// 接口没有国家筛选,按城市白名单留美国岗。
export const US_CITIES = new Set(["San Jose", "Seattle", "Los Angeles", "New York", "San Francisco", "Mountain View", "Austin", "Chicago", "Bellevue", "Washington", "Irvine", "Culver City", "Miami", "Boston", "Nashville", "Sunnyvale", "Redmond", "Dallas", "Denver", "Atlanta", "Portland"]);
interface Post { id: string; title: string; description?: string; requirement?: string; city_info?: { en_name?: string }; recruit_type?: { en_name?: string; parent?: { en_name?: string } }; publish_time?: number; }

export async function fetchBytedance(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const portal = PORTALS[board.ident];
  if (!portal) throw new Error(`bytedance ${board.ident}: unknown portal`);
  const seen = new Map<string, Post>();
  for (const keyword of KEYWORDS) {
    for (let offset = 0; offset < MAX_OFFSET; offset += PAGE) {
      const res = await ctx.fetcher("https://jobs.bytedance.com/api/v1/search/job/posts", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "website-path": portal.path },
        body: JSON.stringify({ keyword, limit: PAGE, offset, job_category_id_list: [], tag_id_list: [], location_code_list: [], subject_id_list: [], recruitment_id_list: [], portal_type: portal.portal, job_function_id_list: [], storefront_id_list: [], portal_entrance: 1 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`bytedance ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { code: number; data?: { job_post_list?: Post[] } };
      if (data.code !== 0) throw new Error(`bytedance ${board.ident}: code ${data.code}`);
      const posts = data.data?.job_post_list ?? [];
      for (const p of posts) if (!seen.has(p.id)) seen.set(p.id, p);
      if (posts.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const p of seen.values()) {
    const city = p.city_info?.en_name ?? "";
    if (!US_CITIES.has(city) || !isEntryLevelTitle(p.title)) continue;
    const applyUrl = portal.url(p.id);
    if (ctx.isKnownUrl(applyUrl)) continue;
    const jdText = [htmlToText(p.description ?? ""), p.requirement ? "Requirements:\n" + htmlToText(p.requirement) : ""].filter(Boolean).join("\n\n");
    out.push({ company: board.company ?? portal.company, title: p.title, location: city, jdText, applyUrl, source: "bytedance", ats: "bytedance", postedAt: p.publish_time ? new Date(p.publish_time).toISOString() : null, jobKind: /intern/i.test(p.title) ? "intern" : "newgrad" });
  }
  return out;
}
