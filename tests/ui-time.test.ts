import { describe, it, expect } from "vitest";
import { parseSqliteUtc, relativeDays, relativeTime, minutesSince, formatDateZh, localShort } from "@/app/lib/time";

describe("ui time", () => {
  const now = Date.parse("2026-09-06T20:00:00Z");
  it("parses sqlite UTC and ISO", () => {
    expect(parseSqliteUtc("2026-09-06 19:30:00")!.toISOString()).toBe("2026-09-06T19:30:00.000Z");
    expect(parseSqliteUtc("2026-09-06T19:30:00Z")!.toISOString()).toBe("2026-09-06T19:30:00.000Z");
    expect(parseSqliteUtc(null)).toBeNull();
    expect(parseSqliteUtc("nope")).toBeNull();
  });
  it("relativeDays: 今天/昨天/N 天前, fresh within 3 days", () => {
    expect(relativeDays("2026-09-06T10:00:00Z", now)).toEqual({ label: "今天", days: 0, fresh: true });
    expect(relativeDays("2026-09-05T10:00:00Z", now)).toEqual({ label: "昨天", days: 1, fresh: true });
    expect(relativeDays("2026-08-30T10:00:00Z", now).label).toBe("7 天前");
    expect(relativeDays("2026-08-30T10:00:00Z", now).fresh).toBe(false);
    expect(relativeDays(null, now)).toEqual({ label: "—", days: null, fresh: false });
  });
  it("relativeTime and minutesSince accept sqlite UTC", () => {
    expect(relativeTime("2026-09-06 19:59:40", now)).toBe("刚刚");
    expect(relativeTime("2026-09-06 19:30:00", now)).toBe("30 分钟前");
    expect(relativeTime("2026-09-06 15:00:00", now)).toBe("5 小时前");
    expect(relativeTime("2026-09-01 15:00:00", now)).toBe("5 天前");
    expect(relativeTime(null, now)).toBe("—");
    expect(minutesSince("2026-09-06 19:30:00", now)).toBe(30);
  });
  it("localShort renders MM-DD HH:MM in local time and tolerates junk", () => {
    expect(localShort("2026-09-06 19:30:00")).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(localShort(null)).toBe("—");
    expect(localShort("junk")).toBe("junk");
  });
  it("formatDateZh", () => {
    expect(formatDateZh(new Date(2026, 8, 6))).toBe("9 月 6 日 · 周日");
    expect(formatDateZh(new Date(2026, 0, 12))).toBe("1 月 12 日 · 周一");
  });
});
