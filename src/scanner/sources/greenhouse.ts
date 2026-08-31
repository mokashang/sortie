import { RawJob, Fetcher } from "@/scanner/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface GhJob {
  title: string;
  absolute_url: string;
  updated_at: string;
  first_published?: string;
  location: { name: string } | null;
  content?: string;
}

export async function fetchGreenhouse(
  boardToken: string,
  companyName: string,
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const res = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`greenhouse ${boardToken}: HTTP ${res.status}`);
  const data = (await res.json()) as { jobs: GhJob[] };
  return (data.jobs ?? [])
    .filter((j) => isEntryLevelTitle(j.title))
    .map((j) => ({
      company: companyName,
      title: j.title,
      location: j.location?.name ?? null,
      jdText: htmlToText(j.content ?? ""),
      applyUrl: j.absolute_url,
      source: "greenhouse" as const,
      ats: "greenhouse",
      // first_published is the true post date; updated_at moves on every re-save
      // and misdates ~87% of postings if used alone.
      postedAt: j.first_published ?? j.updated_at ?? null,
    }));
}
