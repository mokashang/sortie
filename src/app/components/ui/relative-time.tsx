"use client";
import { localFull, parseSqliteUtc, relativeDays, relativeTime } from "@/app/lib/time";
import { useLang } from "@/i18n/client";

export function RelativeTime({ value, mode = "ago", className }: { value: string | null | undefined; mode?: "ago" | "days"; className?: string }) {
  const lang = useLang();
  const d = parseSqliteUtc(value);
  const text = mode === "days" ? relativeDays(value, lang).label : relativeTime(value, lang);
  return (
    <time dateTime={d?.toISOString()} title={d ? localFull(value) : undefined} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
