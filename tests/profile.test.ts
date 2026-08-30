import { describe, it, expect } from "vitest";
import { parseProfile } from "@/lib/profile";

const yamlText = `
name: Test User
email: t@example.com
phone: "+1-000-000-0000"
linkedin: linkedin.com/in/test
github: github.com/test
school: USC
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1
  needs_sponsorship: true
targets:
  primary: newgrad
  secondary: intern
directions:
  swe_general: 1
  ai_infra: 1
daily_minutes_budget: 90
`;

describe("profile", () => {
  it("parses a valid profile", () => {
    const p = parseProfile(yamlText);
    expect(p.name).toBe("Test User");
    expect(p.work_auth.needs_sponsorship).toBe(true);
    expect(p.directions.ai_infra).toBe(1);
  });

  it("rejects missing name", () => {
    expect(() => parseProfile("email: a@b.c")).toThrow();
  });
});
