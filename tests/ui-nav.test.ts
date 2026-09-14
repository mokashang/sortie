import { describe, expect, it } from "vitest";
import { NAV, SETTINGS_NAV, TABBAR_HREFS, isActivePath } from "@/app/components/shell/nav";

describe("shell nav", () => {
  it("marks the home route only on an exact match, other routes on their subtree", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/queue", "/")).toBe(false);
    expect(isActivePath("/queue", "/queue")).toBe(true);
    expect(isActivePath("/queue/anything", "/queue")).toBe(true);
    expect(isActivePath("/queued", "/queue")).toBe(false);
    expect(isActivePath(null, "/queue")).toBe(false);
  });

  it("keeps the phone tab bar to destinations that exist in the main nav", () => {
    const hrefs = new Set(NAV.map((n) => n.href));
    for (const href of TABBAR_HREFS) expect(hrefs.has(href)).toBe(true);
    expect(TABBAR_HREFS.length).toBe(4);
    expect(hrefs.has(SETTINGS_NAV.href)).toBe(false);
  });

  it("has no internal words in the labels", () => {
    for (const n of [...NAV, SETTINGS_NAV]) expect(n.label).not.toMatch(/run|executor|headless|chrome/i);
  });
});
