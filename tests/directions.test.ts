import { describe, it, expect } from "vitest";
import { DIRECTIONS, directionLabel, isKnownDirection } from "@/matcher/directions";

describe("directions catalog", () => {
  it("covers all 12 spec directions", () => {
    expect(Object.keys(DIRECTIONS)).toHaveLength(12);
    expect(DIRECTIONS.ai_infra).toBeDefined();
    expect(DIRECTIONS.quant).toBeDefined();
  });
  it("maps slug to human label", () => {
    expect(directionLabel("swe_backend")).toMatch(/backend/i);
  });
  it("validates known slugs", () => {
    expect(isKnownDirection("ai_infra")).toBe(true);
    expect(isKnownDirection("astrology")).toBe(false);
  });
});
