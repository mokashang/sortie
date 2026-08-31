import { describe, it, expect } from "vitest";
import { isEntryLevelTitle } from "@/scanner/entry-level";

describe("isEntryLevelTitle", () => {
  it("overrides the EXCLUDE list when a strong entry-level signal is present", () => {
    expect(isEntryLevelTitle("Member of Technical Staff New Grad - Machine Learning")).toBe(true);
    expect(isEntryLevelTitle("Associate Product Manager – New Grad")).toBe(true);
    expect(isEntryLevelTitle("GPU Power Architect New Grad")).toBe(true);
  });

  it("still excludes clearly senior titles with no entry-level signal", () => {
    expect(isEntryLevelTitle("Staff Software Engineer")).toBe(false);
    expect(isEntryLevelTitle("Senior Engineering Manager")).toBe(false);
  });

  it("keeps titles that never hit EXCLUDE in the first place", () => {
    expect(isEntryLevelTitle("Leadership Development Program")).toBe(true);
    expect(isEntryLevelTitle("Software Engineer II")).toBe(true);
  });
});
