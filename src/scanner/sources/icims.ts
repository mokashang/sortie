import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// iCIMS 只有网页:搜索页解析职位卡片,再开每个岗的 iframe 页取正文和头部字段。请求慢,并发 2。
const KEYWORDS = ["engineer", "software", "graduate", "intern"];
export interface IcimsCard { id: string; url: string; title: string; location: string | null; }

export function parseIcimsSearch(html: string, host: string): IcimsCard[] {
  const out: IcimsCard[] = [];
  const seen = new Set<string>();
  const esc = host.replace(/\./g, "\\.");
  const re = new RegExp(`<a\\s+href="(https://${esc}/jobs/(\\d+)/[^"?#]+/job)[^"]*"[^>]*class="iCIMS_Anchor"[^>]*>([\\s\\S]*?)</a>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (seen.has(m[2])) continue;
    const inner = m[3];
    const h = inner.match(/<h[23][^>]*>\s*([\s\S]*?)\s*<\/h[23]>/);
    const title = htmlToText(h ? h[1] : inner).trim();
    if (!title) continue;
    // 同一张卡片后面可能带 Job Locations 字段(SIG 这类门户没有)
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const loc = tail.match(/Job Locations<\/span>\s*<span[^>]*>\s*([^<]+?)\s*</);
    seen.add(m[2]);
    out.push({ id: m[2], url: m[1], title, location: loc ? loc[1].trim() : null });
  }
  return out;
}

export function parseIcimsJob(html: string): { jdText: string; fields: Record<string, string> } {
  const blocks = [...html.matchAll(/<div class="iCIMS_Expandable_Text">([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => htmlToText(m[1]));
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<dt class="iCIMS_JobHeaderField">\s*([^<]+?)\s*<\/dt>\s*<dd class="iCIMS_JobHeaderData">\s*(?:<span[^>]*>)?\s*([^<]+?)\s*</g)) fields[m[1].trim()] = m[2].trim();
  return { jdText: blocks.join("\n\n").trim(), fields };
}

export async function fetchIcims(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const host = board.ident;
  const pages = ctx.depth === "core" ? 5 : 2;
  const cards = new Map<string, IcimsCard>();
  for (const kw of KEYWORDS) {
    for (let p = 0; p < pages; p++) {
      const res = await ctx.fetcher(`https://${host}/jobs/search?ss=1&searchKeyword=${encodeURIComponent(kw)}&in_iframe=1&pr=${p}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`icims ${host}: HTTP ${res.status}`);
      const found = parseIcimsSearch(await res.text(), host);
      for (const c of found) if (!cards.has(c.id)) cards.set(c.id, c);
      if (found.length === 0) break;
    }
  }
  const out: RawJob[] = [];
  for (const c of cards.values()) {
    if (!isEntryLevelTitle(c.title) || ctx.isKnownUrl(c.url)) continue;
    let jdText = "", location = c.location, postedAt: string | null = null;
    try {
      const d = await ctx.fetcher(`${c.url}?in_iframe=1`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const parsed = parseIcimsJob(await d.text());
        jdText = parsed.jdText;
        location = location ?? parsed.fields["Job Locations"] ?? parsed.fields["Location"] ?? null;
        const pd = parsed.fields["Posted Date"];
        if (pd && !Number.isNaN(Date.parse(pd))) postedAt = new Date(pd).toISOString().slice(0, 10);
      }
    } catch { /* 空正文入库 */ }
    out.push({ company: board.company ?? host, title: c.title, location, jdText, applyUrl: c.url, source: "icims", ats: "icims", postedAt });
  }
  return out;
}
