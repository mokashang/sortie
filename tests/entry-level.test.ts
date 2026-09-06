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

import { isEngineeringTitle } from "@/scanner/entry-level";
describe("isEngineeringTitle", () => {
  it("passes engineering-ish titles and rejects retail/ops noise", () => {
    for (const t of ["Software Engineer", "Firmware Engineer II", "Quantitative Researcher", "Data Scientist", "GPU Kernel Developer", "Security Analyst", "Robotics Perception Intern", "Machine Learning Engineer", "SRE", "Technical Program Manager"])
      expect(isEngineeringTitle(t), t).toBe(true);
    for (const t of ["Fulfillment Associate", "Tax Intern", "Sales & Operations Advisor in Training", "Registered Nurse", "Store Manager", "Marketing Coordinator"])
      expect(isEngineeringTitle(t), t).toBe(false);
  });
});
