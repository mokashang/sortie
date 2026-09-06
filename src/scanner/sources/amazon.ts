import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// amazon.jobs 的 search.json:自带正文、资格要求和日期,只取美国。
const QUERIES = ["graduate", "early career", "new grad", "university"];
const PAGE = 100;
interface AmzJob { id: string; title: string; job_path: string; posted_date?: string; description?: string; basic_qualifications?: string; preferred_qualifications?: string; normalized_location?: string; location?: string; country_code?: string; is_intern?: boolean; }

// "September  4, 2026"(双空格)→ "2026-09-04"
export function parseAmazonDate(s: string | undefined): string | null {
  if (!s) return null;
  const d = new Date(s.replace(/\s+/g, " ").trim() + " UTC");
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function fetchAmazon(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const cap = ctx.depth === "core" ? 300 : 100;
  const seen = new Map<string, AmzJob>();
  for (const q of QUERIES) {
    for (let offset = 0; offset < cap; offset += PAGE) {
      const url = `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}&country%5B%5D=USA&normalized_country_code%5B%5D=USA&result_limit=${PAGE}&offset=${offset}&sort=recent`;
      const res = await ctx.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`amazon ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { jobs?: AmzJob[] };
      const jobs = data.jobs ?? [];
      for (const j of jobs) if (!seen.has(j.id)) seen.set(j.id, j);
      if (jobs.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const j of seen.values()) {
    if (j.country_code && j.country_code !== "USA") continue;
    if (!isEntryLevelTitle(j.title)) continue;
    const applyUrl = `https://www.amazon.jobs${j.job_path}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    const parts = [j.description, j.basic_qualifications ? "Basic qualifications:\n" + j.basic_qualifications : "", j.preferred_qualifications ? "Preferred qualifications:\n" + j.preferred_qualifications : ""];
    const jdText = parts.filter((s): s is string => !!s).map((s) => htmlToText(s)).join("\n\n");
    out.push({ company: "Amazon", title: j.title.trim(), location: j.normalized_location ?? j.location ?? null, jdText, applyUrl, source: "amazon", ats: "amazon", postedAt: parseAmazonDate(j.posted_date), jobKind: j.is_intern ? "intern" : undefined });
  }
  return out;
}
