import { RawJob, Fetcher } from "@/scanner/types";
import { safeIso } from "@/scanner/dates";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { parseReadmeTable } from "@/scanner/sources/readme-table";

interface Listing {
  company_name: string;
  title: string;
  locations?: string[];
  url: string;
  active?: boolean;
  is_visible?: boolean;
  sponsorship?: string;
  date_posted?: number;
}

// 清单里的 sponsorship 枚举实际有 4 种取值,只有其中两种是我们要在 jdText 里
// 注入标记文本、让统一的 visaFlag 关键词过滤捕获的("Offers Sponsorship" 和
// 未知/"Other" 都不需要标记)。
function sponsorshipMarker(sponsorship: string | undefined): string {
  if (sponsorship === "Does Not Offer Sponsorship") return "[listing metadata] no visa sponsorship";
  if (sponsorship === "U.S. Citizenship is Required") return "[listing metadata] u.s. citizenship is required";
  return "";
}

export function mapListings(data: Listing[] | null | undefined, kind: "newgrad" | "intern"): RawJob[] {
  return (data ?? [])
    .filter((l) => l.active !== false && l.is_visible !== false)
    .map((l) => ({
      company: l.company_name,
      title: l.title,
      location: l.locations?.join("; ") ?? null,
      jdText: sponsorshipMarker(l.sponsorship),
      applyUrl: l.url,
      source: "github_list" as const,
      ats: null,
      postedAt: l.date_posted ? safeIso(l.date_posted * 1000) : null,
      // 清单本身就分 newgrad/intern 两个 repo,是权威判定,不必等下游从标题猜
      // (9% 的 intern 岗标题里没有 "intern" 字样,标题猜测会误判成 newgrad)。
      jobKind: kind,
    }));
}

export async function fetchGithubList(
  rawUrl: string,
  kind: "newgrad" | "intern",
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const res = await fetcher(rawUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`github list ${rawUrl}: HTTP ${res.status}`);
  const data = (await res.json()) as Listing[];
  return mapListings(data, kind);
}

// 默认监控的清单(config 而非硬编码个人信息;Phase B 用户可换)
export const DEFAULT_LISTS: { url: string; kind: "newgrad" | "intern" }[] = [
  {
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    kind: "newgrad",
  },
  {
    // Verified live via smoke test on 2026-08-30 (2259 listings). If SimplifyJobs ever
    // renames/retires this repo before the next internship cycle, this URL could start
    // 404ing — the scheduler tolerates per-board failure, so a stale URL here only drops
    // this one list rather than blocking the whole scan.
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
    kind: "intern",
  },
];

// 6 份清单,各是 boards 里的一行(family=github_list,origin=builtin)。前四份有机器可读的 JSON,
// zapplyjobs 两份只有 README 表格。净增量实测(2026-09-05):vanshb03 +593/+219,zapplyjobs +547/+435。
export interface ListBoard { key: string; company: string; url: string; kind: "newgrad" | "intern"; format: "json" | "readme"; }
export const LIST_BOARDS: ListBoard[] = [
  { key: "github_list:simplify-newgrad", company: "SimplifyJobs/New-Grad-Positions", url: DEFAULT_LISTS[0].url, kind: "newgrad", format: "json" },
  { key: "github_list:simplify-intern-2027", company: "SimplifyJobs/Summer2027-Internships", url: DEFAULT_LISTS[1].url, kind: "intern", format: "json" },
  { key: "github_list:vanshb03-newgrad-2027", company: "vanshb03/New-Grad-2027", url: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json", kind: "newgrad", format: "json" },
  { key: "github_list:vanshb03-intern-2027", company: "vanshb03/Summer2027-Internships", url: "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json", kind: "intern", format: "json" },
  { key: "github_list:zapply-newgrad-2027", company: "zapplyjobs/New-Grad-Jobs-2027", url: "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Jobs-2027/main/README.md", kind: "newgrad", format: "readme" },
  { key: "github_list:zapply-intern-2027", company: "zapplyjobs/Internships-2027", url: "https://raw.githubusercontent.com/zapplyjobs/Internships-2027/main/README.md", kind: "intern", format: "readme" },
];

// 条件请求:上次的 ETag 存在 boards.meta 里,GitHub 没更新就 304,一次握手了事。
export async function fetchListBoard(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const spec = LIST_BOARDS.find((l) => l.key === board.key);
  if (!spec) throw new Error(`github_list ${board.ident}: unknown list`);
  let etag: string | undefined;
  try { etag = board.meta ? (JSON.parse(board.meta) as { etag?: string }).etag : undefined; } catch { etag = undefined; }
  const res = await ctx.fetcher(spec.url, { headers: etag ? { "if-none-match": etag } : {}, signal: AbortSignal.timeout(30_000) });
  if (res.status === 304) return [];
  if (!res.ok) throw new Error(`github_list ${board.ident}: HTTP ${res.status}`);
  const rows = spec.format === "json" ? mapListings((await res.json()) as Listing[], spec.kind) : parseReadmeTable(await res.text(), { kind: spec.kind, now: ctx.now });
  // ETag 只在成功解析之后才记:否则解析抛错后下次直接 304,这份清单就永远读不到了。
  const newTag = res.headers.get("etag");
  if (newTag && newTag !== etag) ctx.setMeta?.({ etag: newTag });
  return rows;
}
