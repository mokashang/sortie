// Time helpers for the UI. sqlite's datetime('now') is UTC without a marker ("YYYY-MM-DD
// HH:MM:SS"); ISO strings from JSON columns carry their own zone. Both are accepted everywhere.

export function parseSqliteUtc(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? `${ts.replace(" ", "T")}Z` : ts;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Posting age: 今天 / 昨天 / N 天前, and whether it still counts as fresh (≤ 3 days).
export function relativeDays(iso: string | null | undefined, now: number = Date.now()): { label: string; days: number | null; fresh: boolean } {
  const d = parseSqliteUtc(iso);
  if (!d) return { label: "—", days: null, fresh: false };
  const days = Math.max(0, Math.floor((now - d.getTime()) / 86_400_000));
  return { label: days === 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`, days, fresh: days <= 3 };
}

export function relativeTime(ts: string | null | undefined, now: number = Date.now()): string {
  const d = parseSqliteUtc(ts);
  if (!d) return "—";
  const m = Math.floor((now - d.getTime()) / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
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

export function formatDateZh(d: Date): string {
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${"日一二三四五六"[d.getDay()]}`;
}
