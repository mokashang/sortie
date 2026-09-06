import { RawJob } from "@/scanner/types";

// 只有 README 表格、没有 JSON 的清单(zapplyjobs 系列):| Company | Role | Location | Posted | Visa | Apply |
// `↳` 表示沿用上一行的公司;Posted 列是相对年龄(12m / 2h / 3d / 1w / 1mo)。
const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000, mo: 30 * 86_400_000 };
export function parseAge(s: string, now: Date): string | null {
  const m = s.trim().match(/^(\d+)\s*(mo|m|h|d|w)$/i);
  if (!m) return null;
  return new Date(now.getTime() - Number(m[1]) * UNITS[m[2].toLowerCase()]).toISOString();
}
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\*\*/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/&amp;/g, "&").trim();
const links = (cell: string) => [...cell.matchAll(/\((https?:\/\/[^)\s]+)\)|href="(https?:\/\/[^"]+)"/g)].map((m) => m[1] ?? m[2]);

export function parseReadmeTable(md: string, opts: { kind: "newgrad" | "intern"; now: Date }): RawJob[] {
  const lines = md.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return [];
  const header = lines[0].split("|").slice(1, -1).map((h) => strip(h).toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const ci = col(["company"]), ti = col(["role", "title", "position"]), li = col(["location"]), ai = col(["posted", "age", "date"]), ki = col(["apply", "link"]);
  if (ci < 0 || ti < 0) return [];
  const out: RawJob[] = [];
  let lastCompany = "";
  for (const line of lines.slice(1)) {
    if (/^\|\s*:?-+/.test(line)) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length <= Math.max(ci, ti)) continue;
    let company = strip(cells[ci]);
    if (company === "↳" || company === "") company = lastCompany; else lastCompany = company;
    const title = strip(cells[ti]);
    const url = (ki >= 0 ? links(cells[ki]) : links(line)).find((u) => !/simplify\.jobs\/p\/|images\/apply|jobright\.ai\/jobs\/info/.test(u));
    if (!company || !title || !url) continue;
    out.push({
      company, title,
      location: li >= 0 ? strip(cells[li].replace(/<\/?br\s*\/?>/gi, "; ")) || null : null,
      jdText: "", applyUrl: url, source: "github_list", ats: null,
      postedAt: ai >= 0 ? parseAge(strip(cells[ai]), opts.now) : null,
      jobKind: opts.kind,
    });
  }
  return out;
}
