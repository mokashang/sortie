// Links in a drafted message must be ones the App handed the model (job links, the candidate's
// own profiles, links the other person sent). A model retyping a long URL drops or swaps a
// letter now and then — run 436 caught "job-boards.greenhouge.io" in a DRW intro and sent it
// back, and the message then sat as a draft nobody re-approved. Pure helpers so the follow-up
// drafter can repair such a typo in code (nearest allowed link) or reject the draft.

const URL_RE = /https?:\/\/[^\s<>"'()\[\]]+/gi;
// A typo, not a different link: a few characters apart.
const MAX_TYPO_DISTANCE = 4;

export function extractUrls(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""));
}

// Scheme, "www." and a trailing slash don't make two links different.
export function normalizeUrl(u: string): string {
  return u
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .replace(/^([^/]+)/, (host) => host.toLowerCase());
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > MAX_TYPO_DISTANCE) return MAX_TYPO_DISTANCE + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface LinkCheck {
  text: string; // with near-miss links replaced by the allowed link they were meant to be
  fixed: { from: string; to: string }[];
  unknown: string[]; // links that are nothing like any allowed one
}

export function checkLinks(text: string, allowed: (string | null | undefined)[]): LinkCheck {
  const linkish = (a: string) => /^https?:\/\/\S+$/i.test(a) || /^[^\s@]+\.[^\s@]+$/.test(a);
  const pool = Array.from(new Set(allowed.map((a) => a?.trim()).filter((a): a is string => !!a && linkish(a))));
  const known = new Map(pool.map((a) => [normalizeUrl(a), a]));
  let out = text;
  const fixed: LinkCheck["fixed"] = [];
  const unknown: string[] = [];
  for (const url of extractUrls(text)) {
    const n = normalizeUrl(url);
    if (known.has(n)) continue;
    let best: { to: string; d: number } | null = null;
    for (const [kn, original] of known) {
      const d = distance(n, kn);
      if (d <= MAX_TYPO_DISTANCE && (!best || d < best.d)) best = { to: /^https?:\/\//i.test(original) ? original : `https://${original}`, d };
    }
    if (best) {
      out = out.split(url).join(best.to);
      fixed.push({ from: url, to: best.to });
    } else unknown.push(url);
  }
  return { text: out, fixed, unknown };
}
