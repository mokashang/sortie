import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// SmartRecruiters 公开 API:列表按公司 ID + 只取美国,详情拿 JD 三段。
interface Posting { id: string; name: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string; fullLocation?: string; remote?: boolean }; }
interface Detail { jobAd?: { sections?: Record<string, { title?: string; text?: string }> }; }

export async function fetchSmartRecruiters(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const id = board.ident;
  const cap = ctx.depth === "core" ? 500 : 200;
  const items: Posting[] = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const res = await ctx.fetcher(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings?limit=100&offset=${offset}&country=us`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`smartrecruiters ${id}: HTTP ${res.status}`);
    const data = (await res.json()) as { totalFound?: number; content?: Posting[] };
    const page = data.content ?? [];
    items.push(...page);
    if (page.length === 0 || offset + 100 >= (data.totalFound ?? 0)) break;
  }
  const out: RawJob[] = [];
  for (const p of items) {
    if (!isEntryLevelTitle(p.name)) continue;
    const applyUrl = `https://jobs.smartrecruiters.com/${id}/${p.id}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "";
    try {
      const d = await ctx.fetcher(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings/${p.id}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const sections = ((await d.json()) as Detail).jobAd?.sections ?? {};
        jdText = ["jobDescription", "qualifications", "additionalInformation"].map((k) => sections[k]?.text ?? "").filter(Boolean).map((s) => htmlToText(s)).join("\n\n");
      }
    } catch { /* 空正文入库 */ }
    const loc = p.location;
    const location = loc?.fullLocation ?? [loc?.city, loc?.region, loc?.country?.toUpperCase()].filter(Boolean).join(", ");
    out.push({ company: board.company ?? id, title: p.name, location: location || null, jdText, applyUrl, source: "smartrecruiters", ats: "smartrecruiters", postedAt: p.releasedDate ?? null });
  }
  return out;
}
