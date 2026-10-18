import { Fetcher } from "@/scanner/types";
import { htmlToText } from "@/scanner/html";
import { fetchPublic } from "@/lib/public-url";

// Backfill-only JD fetcher: given an apply_url already sitting in the DB (from a scan pass
// that only captured "[listing metadata]" or an empty jd_text), GET the live page and try to
// pull out real posting text. Best-effort — any failure (network, non-200, non-HTML, whatever)
// returns null so the caller can just skip that job and move on to the next one.
const MAX_CHARS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/128.0.0.0 Safari/537.36";

// The URL may come from outside (问助手's read_posting / add_job), so the fetch only reaches
// public hosts, redirects included (src/lib/public-url.ts).
export async function fetchJdText(url: string, fetcher?: Fetcher): Promise<string | null> {
  try {
    const res = await fetchPublic(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": USER_AGENT } }, { fetcher });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("html")) return null;
    const html = await res.text();
    const stripped = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, "");
    const text = htmlToText(stripped);
    return text.length <= MAX_CHARS ? text : text.slice(0, MAX_CHARS);
  } catch {
    return null;
  }
}
