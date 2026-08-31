import { RawJob, Fetcher } from "@/scanner/types";
import { safeIso } from "@/scanner/dates";

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

export async function fetchGithubList(
  rawUrl: string,
  kind: "newgrad" | "intern",
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const res = await fetcher(rawUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`github list ${rawUrl}: HTTP ${res.status}`);
  const data = (await res.json()) as Listing[];
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

// 默认监控的清单(config 而非硬编码个人信息;Phase B 用户可换)
export const DEFAULT_LISTS: { url: string; kind: "newgrad" | "intern" }[] = [
  {
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    kind: "newgrad",
  },
  {
    // Verified live via smoke test on 2026-08-30 (2259 listings). If SimplifyJobs ever
    // renames/retires this repo before the next internship cycle, this URL could start
    // 404ing — the scan orchestrator (Task 10) tolerates per-source failure, so a stale
    // URL here only drops this one source rather than blocking the whole scan.
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
    kind: "intern",
  },
];
