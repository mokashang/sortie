import { localFull, parseSqliteUtc, relativeDays, relativeTime } from "@/app/lib/time";

export function RelativeTime({ value, mode = "ago", className }: { value: string | null | undefined; mode?: "ago" | "days"; className?: string }) {
  const d = parseSqliteUtc(value);
  const text = mode === "days" ? relativeDays(value).label : relativeTime(value);
  return (
    <time dateTime={d?.toISOString()} title={d ? localFull(value) : undefined} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
