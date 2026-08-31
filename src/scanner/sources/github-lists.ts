import { RawJob, Fetcher } from "@/scanner/types";

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

export async function fetchGithubList(
  rawUrl: string,
  _kind: "newgrad" | "intern",
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const res = await fetcher(rawUrl);
  if (!res.ok) throw new Error(`github list ${rawUrl}: HTTP ${res.status}`);
  const data = (await res.json()) as Listing[];
  return (data ?? [])
    .filter((l) => l.active !== false && l.is_visible !== false)
    .map((l) => ({
      company: l.company_name,
      title: l.title,
      location: l.locations?.join("; ") ?? null,
      jdText:
        l.sponsorship === "Does Not Offer Sponsorship"
          ? "[listing metadata] no visa sponsorship"
          : "",
      applyUrl: l.url,
      source: "github_list" as const,
      ats: null,
      postedAt: l.date_posted ? new Date(l.date_posted * 1000).toISOString() : null,
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
