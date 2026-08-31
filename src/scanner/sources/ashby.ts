import { RawJob, Fetcher } from "@/scanner/types";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface AshbyJob {
  title: string;
  location?: string;
  jobUrl: string;
  publishedAt?: string;
  descriptionPlain?: string;
  isListed?: boolean;
}

export async function fetchAshby(
  boardName: string,
  companyName: string,
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}?includeCompensation=false`;
  const res = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`ashby ${boardName}: HTTP ${res.status}`);
  const data = (await res.json()) as { jobs: AshbyJob[] };
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false && isEntryLevelTitle(j.title))
    .map((j) => ({
      company: companyName,
      title: j.title,
      location: j.location ?? null,
      jdText: j.descriptionPlain ?? "",
      applyUrl: j.jobUrl,
      source: "ashby" as const,
      ats: "ashby",
      postedAt: j.publishedAt ?? null,
    }));
}
