import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// Oracle HCM(Oracle Cloud Recruiting)的公开 REST:每个 <host>/<site> 一个板块,按关键词取最新,详情拿 JD。
const KEYWORDS = ["engineer", "software", "graduate", "intern"];
const PAGE = 25;
interface Req { Id: string; Title: string; PrimaryLocation?: string; PostedDate?: string; secondaryLocations?: { Name?: string }[]; }

export async function fetchOracle(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const slash = board.ident.indexOf("/");
  const host = slash > 0 ? board.ident.slice(0, slash) : "", site = slash > 0 ? board.ident.slice(slash + 1) : "";
  if (!host || !site) throw new Error(`oracle ${board.ident}: bad ident`);
  const cap = ctx.depth === "core" ? 100 : 50;
  const seen = new Map<string, Req>();
  for (const kw of KEYWORDS) {
    for (let offset = 0; offset < cap; offset += PAGE) {
      const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=${PAGE},offset=${offset},keyword=${encodeURIComponent(kw)},sortBy=POSTING_DATES_DESC`;
      const res = await ctx.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`oracle ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { items?: { requisitionList?: Req[] }[] };
      const list = data.items?.[0]?.requisitionList ?? [];
      for (const r of list) if (!seen.has(r.Id)) seen.set(r.Id, r);
      if (list.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const r of seen.values()) {
    if (!isEntryLevelTitle(r.Title)) continue;
    const applyUrl = `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "";
    try {
      const d = await ctx.fetcher(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${r.Id}%22,siteNumber=${site}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const it = ((await d.json()) as { items?: { ExternalDescriptionStr?: string; ExternalQualificationsStr?: string; ExternalResponsibilitiesStr?: string }[] }).items?.[0] ?? {};
        jdText = [it.ExternalDescriptionStr, it.ExternalResponsibilitiesStr, it.ExternalQualificationsStr].filter((s): s is string => !!s).map((s) => htmlToText(s)).join("\n\n");
      }
    } catch { /* 空正文入库 */ }
    const location = [r.PrimaryLocation, ...(r.secondaryLocations ?? []).map((s) => s.Name)].filter(Boolean).join("; ") || null;
    out.push({ company: board.company ?? host, title: r.Title, location, jdText, applyUrl, source: "oracle", ats: "oracle", postedAt: r.PostedDate ?? null });
  }
  return out;
}
