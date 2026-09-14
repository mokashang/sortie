// Time helpers for the UI. sqlite's datetime('now') is UTC without a marker ("YYYY-MM-DD
// HH:MM:SS"); ISO strings from JSON columns carry their own zone. Both are accepted everywhere.
// Anything that renders words takes the UI language; numeric timestamps are language-free.
import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";

export function parseSqliteUtc(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? `${ts.replace(" ", "T")}Z` : ts;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Posting age: 今天 / 昨天 / N 天前 (Today / Yesterday / N days ago), and whether it still
// counts as fresh (≤ 3 days).
export function relativeDays(
  iso: string | null | undefined,
  lang: Lang,
  now: number = Date.now()
): { label: string; days: number | null; fresh: boolean } {
  const t = messages[lang].time;
  const d = parseSqliteUtc(iso);
  if (!d) return { label: "—", days: null, fresh: false };
  const days = Math.max(0, Math.floor((now - d.getTime()) / 86_400_000));
  return { label: days === 0 ? t.today : days === 1 ? t.yesterday : t.daysAgo(days), days, fresh: days <= 3 };
}

export function relativeTime(ts: string | null | undefined, lang: Lang, now: number = Date.now()): string {
  const t = messages[lang].time;
  const d = parseSqliteUtc(ts);
  if (!d) return "—";
  const m = Math.floor((now - d.getTime()) / 60_000);
  if (m < 1) return t.justNow;
  if (m < 60) return t.minutesAgo(m);
  const h = Math.floor(m / 60);
  if (h < 24) return t.hoursAgo(h);
  return t.daysAgo(Math.floor(h / 24));
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localShort(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = parseSqliteUtc(ts);
  if (!d) return ts;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localFull(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = parseSqliteUtc(ts);
  if (!d) return ts;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function minutesSince(ts: string, now: number = Date.now()): number {
  const d = parseSqliteUtc(ts);
  if (!d) return 0;
  return Math.max(0, Math.round((now - d.getTime()) / 60_000));
}

// "9 月 6 日 · 周日" / "Sep 6 · Sun" — the 今日 page's date line.
export function formatDate(d: Date, lang: Lang): string {
  return messages[lang].time.date(d);
}
