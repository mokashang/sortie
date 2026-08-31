import { describe, it, expect } from "vitest";
import { ExperienceInputSchema } from "@/resume/experiences";

// The API handlers are thin wrappers over the repo (already tested). This locks the request
// contract: the schema rejects a bad payload and accepts a good one.
describe("experiences API contract", () => {
  it("accepts a valid create payload", () => {
    const r = ExperienceInputSchema.safeParse({ kind: "work", title: "X", bullets: [] });
    expect(r.success).toBe(true);
  });
  it("rejects an invalid kind", () => {
    const r = ExperienceInputSchema.safeParse({ kind: "bogus", title: "X" });
    expect(r.success).toBe(false);
  });
});
