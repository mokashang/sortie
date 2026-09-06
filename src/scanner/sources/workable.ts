import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// Workable 公开接口:v3 列表按 nextPage token 翻页,v2 详情拿 description + requirements。
interface WkJob { title: string; shortcode: string; published?: string; remote?: boolean; location?: { city?: string; region?: string; country?: string; countryCode?: string }; }

export async function fetchWorkable(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const acct = board.ident;
  const cap = ctx.depth === "core" ? 300 : 100;
  const items: WkJob[] = [];
  let token: string | undefined;
  while (items.length < cap) {
    const res = await ctx.fetcher(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(acct)}/jobs`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`workable ${acct}: HTTP ${res.status}`);
    const data = (await res.json()) as { results?: WkJob[]; nextPage?: string };
    items.push(...(data.results ?? []));
    if (!data.nextPage || (data.results ?? []).length === 0) break;
    token = data.nextPage;
  }
  const out: RawJob[] = [];
  for (const j of items) {
    const us = j.location?.countryCode === "US" || j.location?.country === "United States" || (!j.location?.country && j.remote);
    if (!us || !isEntryLevelTitle(j.title)) continue;
    const applyUrl = `https://apply.workable.com/${acct}/j/${j.shortcode}/`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "";
    try {
      const d = await ctx.fetcher(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(acct)}/jobs/${j.shortcode}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const det = (await d.json()) as { description?: string; requirements?: string };
        jdText = [det.description, det.requirements ? "Requirements:\n" + det.requirements : ""].filter((s): s is string => !!s).map((s) => htmlToText(s)).join("\n\n");
      }
    } catch { /* 空正文入库 */ }
    const location = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ") || (j.remote ? "Remote, US" : null);
    out.push({ company: board.company ?? acct, title: j.title, location, jdText, applyUrl, source: "workable", ats: "workable", postedAt: j.published ?? null });
  }
  return out;
}
