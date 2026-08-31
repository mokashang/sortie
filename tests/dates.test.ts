import { describe, it, expect } from "vitest";
import { safeIso } from "@/scanner/dates";

describe("safeIso", () => {
  it("converts a valid epoch ms number to ISO", () => {
    expect(safeIso(1787875200000)).toBe(new Date(1787875200000).toISOString());
  });

  it("returns null for malformed input instead of throwing", () => {
    expect(safeIso("n/a")).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(safeIso(null)).toBeNull();
    expect(safeIso(undefined)).toBeNull();
    expect(safeIso("")).toBeNull();
  });
});
