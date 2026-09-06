import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// LinkedIn 免登录的游客接口:搜索返回职位卡片 HTML 片段,详情有正文但没有外部申请链接(要登录才给),
// 所以 applyUrl 记 LinkedIn 职位页,投递时在用户 Chrome 里点 Apply 跳转。保守节流:顺序执行、每次间隔 3s,
// 连续两次 429/999 就抛错(调度器会把 next_due 推到明天)。
export const LINKEDIN_QUERIES: Record<string, string[]> = {
  swe_general: ['"new grad" software engineer', 'software engineer "university graduate" 2027'],
  swe_backend: ['"new grad" backend engineer', '"new grad" distributed systems engineer'],
  ai_infra: ['"new grad" machine learning infrastructure engineer', '"new grad" ML systems engineer'],
  mle: ['"new grad" machine learning engineer', '"new grad" applied scientist'],
  quant: ['"new grad" quantitative developer', '"new grad" quantitative researcher'],
  embedded: ['"new grad" embedded software engineer', '"new grad" firmware engineer'],
  systems_perf: ['"new grad" systems engineer performance', '"new grad" compiler engineer'],
  robotics: ['"new grad" robotics software engineer', '"new grad" autonomy engineer'],
  sre_infra: ['"new grad" site reliability engineer', '"new grad" infrastructure engineer'],
  data: ['"new grad" data engineer', '"new grad" data scientist'],
  security: ['"new grad" security engineer', '"new grad" security analyst'],
  gpu_cuda: ['"new grad" CUDA engineer', '"new grad" GPU kernel engineer'],
};
export interface LiCard { id: string; title: string; company: string; location: string | null; postedAt: string | null; }
export interface LiDetail { title: string | null; company: string | null; location: string | null; jdText: string; criteria: Record<string, string>; }

const clean = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim();

export function parseLinkedinCards(html: string): LiCard[] {
  const out: LiCard[] = [];
  const parts = html.split(/<div class="base-card/).slice(1);
  for (const p of parts) {
    const id = p.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/)?.[1];
    const title = p.match(/base-search-card__title">([\s\S]*?)<\/h3>/)?.[1];
    if (!id || !title) continue;
    const company = p.match(/base-search-card__subtitle">([\s\S]*?)<\/h4>/)?.[1] ?? "";
    const location = p.match(/job-search-card__location">([\s\S]*?)<\/span>/)?.[1];
    const postedAt = p.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? null;
    out.push({ id, title: clean(title), company: clean(company), location: location ? clean(location) : null, postedAt });
  }
  return out;
}

export function parseLinkedinDetail(html: string): LiDetail {
  const title = html.match(/<h2 class="top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/)?.[1];
  const company = html.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/)?.[1];
  const location = html.match(/topcard__flavor topcard__flavor--bullet">([\s\S]*?)<\/span>/)?.[1];
  const desc = html.match(/show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const criteria: Record<string, string> = {};
  for (const m of html.matchAll(/description__job-criteria-subheader">\s*([^<]+?)\s*<\/h3>\s*<span[^>]*>\s*([^<]+?)\s*</g)) criteria[m[1].trim()] = m[2].trim();
  return { title: title ? clean(title) : null, company: company ? clean(company) : null, location: location ? clean(location) : null, jdText: htmlToText(desc).trim(), criteria };
}

export async function fetchLinkedinGuest(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const staleDays = board.last_ok_at ? (ctx.now.getTime() - new Date(board.last_ok_at.replace(" ", "T") + "Z").getTime()) / 86_400_000 : 99;
  const tpr = staleDays > 2 ? "r604800" : "r86400";   // 两天以上没成功跑过就看过去一周
  const maxDetails = ctx.depth === "core" ? 80 : 40;
  const pages = ctx.depth === "core" ? 3 : 2;
  const cards = new Map<string, LiCard>();
  let strikes = 0;
  const get = async (url: string): Promise<string | null> => {
    const res = await ctx.fetcher(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 || res.status === 999) {
      if (++strikes >= 2) throw new Error(`linkedin guest: HTTP ${res.status}`);
      await sleep(30_000);
      return null;
    }
    if (!res.ok) throw new Error(`linkedin guest: HTTP ${res.status}`);
    await sleep(3000);
    return res.text();
  };
  for (const queries of Object.values(LINKEDIN_QUERIES)) {
    for (const kw of queries) {
      for (let p = 0; p < pages; p++) {
        const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&location=United%20States&f_TPR=${tpr}&f_E=1%2C2&sortBy=DD&start=${p * 25}`);
        if (html === null) continue;
        const found = parseLinkedinCards(html);
        for (const c of found) if (!cards.has(c.id)) cards.set(c.id, c);
        if (found.length === 0) break;
      }
    }
  }
  const out: RawJob[] = [];
  for (const c of cards.values()) {
    if (out.length >= maxDetails) break;
    if (!isEntryLevelTitle(c.title)) continue;
    const applyUrl = `https://www.linkedin.com/jobs/view/${c.id}/`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "", location = c.location, title = c.title, company = c.company;
    const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${c.id}`);
    if (html) {
      const d = parseLinkedinDetail(html);
      jdText = d.jdText; location = d.location ?? location; title = d.title ?? title; company = d.company ?? company;
    }
    if (!company) continue;
    out.push({ company, title, location, jdText, applyUrl, source: "linkedin", ats: null, postedAt: c.postedAt });
  }
  return out;
}
