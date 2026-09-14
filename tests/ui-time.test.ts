import { describe, it, expect } from "vitest";
import { parseSqliteUtc, relativeDays, relativeTime, minutesSince, formatDate, localShort } from "@/app/lib/time";

describe("ui time", () => {
  const now = Date.parse("2026-09-06T20:00:00Z");
  it("parses sqlite UTC and ISO", () => {
    expect(parseSqliteUtc("2026-09-06 19:30:00")!.toISOString()).toBe("2026-09-06T19:30:00.000Z");
    expect(parseSqliteUtc("2026-09-06T19:30:00Z")!.toISOString()).toBe("2026-09-06T19:30:00.000Z");
    expect(parseSqliteUtc(null)).toBeNull();
    expect(parseSqliteUtc("nope")).toBeNull();
  });
  it("relativeDays: 今天/昨天/N 天前, fresh within 3 days", () => {
    expect(relativeDays("2026-09-06T10:00:00Z", "zh", now)).toEqual({ label: "今天", days: 0, fresh: true });
    expect(relativeDays("2026-09-05T10:00:00Z", "zh", now)).toEqual({ label: "昨天", days: 1, fresh: true });
    expect(relativeDays("2026-08-30T10:00:00Z", "zh", now).label).toBe("7 天前");
    expect(relativeDays("2026-08-30T10:00:00Z", "zh", now).fresh).toBe(false);
    expect(relativeDays(null, "zh", now)).toEqual({ label: "—", days: null, fresh: false });
  });
  it("relativeDays in English", () => {
    expect(relativeDays("2026-09-06T10:00:00Z", "en", now).label).toBe("Today");
    expect(relativeDays("2026-09-05T10:00:00Z", "en", now).label).toBe("Yesterday");
    expect(relativeDays("2026-08-30T10:00:00Z", "en", now).label).toBe("7 days ago");
  });
  it("relativeTime and minutesSince accept sqlite UTC", () => {
    expect(relativeTime("2026-09-06 19:59:40", "zh", now)).toBe("刚刚");
    expect(relativeTime("2026-09-06 19:30:00", "zh", now)).toBe("30 分钟前");
    expect(relativeTime("2026-09-06 15:00:00", "zh", now)).toBe("5 小时前");
    expect(relativeTime("2026-09-01 15:00:00", "zh", now)).toBe("5 天前");
    expect(relativeTime(null, "zh", now)).toBe("—");
    expect(minutesSince("2026-09-06 19:30:00", now)).toBe(30);
  });
  it("relativeTime in English, with singulars", () => {
    expect(relativeTime("2026-09-06 19:59:40", "en", now)).toBe("Just now");
    expect(relativeTime("2026-09-06 19:59:00", "en", now)).toBe("1 min ago");
    expect(relativeTime("2026-09-06 19:30:00", "en", now)).toBe("30 min ago");
    expect(relativeTime("2026-09-06 19:00:00", "en", now)).toBe("1 hour ago");
    expect(relativeTime("2026-09-06 15:00:00", "en", now)).toBe("5 hours ago");
    expect(relativeTime("2026-09-05 15:00:00", "en", now)).toBe("1 day ago");
    expect(relativeTime("2026-09-01 15:00:00", "en", now)).toBe("5 days ago");
  });
  it("localShort renders MM-DD HH:MM in local time and tolerates junk", () => {
    expect(localShort("2026-09-06 19:30:00")).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(localShort(null)).toBe("—");
    expect(localShort("junk")).toBe("junk");
  });
  it("formatDate", () => {
    expect(formatDate(new Date(2026, 8, 6), "zh")).toBe("9 月 6 日 · 周日");
    expect(formatDate(new Date(2026, 0, 12), "zh")).toBe("1 月 12 日 · 周一");
    expect(formatDate(new Date(2026, 8, 6), "en")).toBe("Sep 6 · Sun");
    expect(formatDate(new Date(2026, 0, 12), "en")).toBe("Jan 12 · Mon");
  });
});
