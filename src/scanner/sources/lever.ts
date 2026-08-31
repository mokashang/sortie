import { RawJob, Fetcher } from "@/scanner/types";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface LeverPosting {
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories?: { location?: string };
  descriptionPlain?: string;
}

export async function fetchLever(
  site: string,
  companyName: string,
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`lever ${site}: HTTP ${res.status}`);
  const data = (await res.json()) as LeverPosting[];
  return (data ?? [])
    .filter((p) => isEntryLevelTitle(p.text))
    .map((p) => ({
      company: companyName,
      title: p.text,
      location: p.categories?.location ?? null,
      jdText: p.descriptionPlain ?? "",
      applyUrl: p.hostedUrl,
      source: "lever" as const,
      ats: "lever",
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    }));
}
