import { describe, it, expect } from "vitest";
import { parseProfile, parseProfileData, emptyProfileData, REQUIRED_PROFILE_FIELDS } from "@/lib/profile";

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

  it("rejects an invalid email format", () => {
    const bad = yamlText.replace("t@example.com", "not-an-email");
    expect(() => parseProfile(bad)).toThrow();
  });

  it("rejects an empty directions map", () => {
    const bad = yamlText.replace(/directions:\n  swe_general: 1\n  ai_infra: 1\n/, "directions: {}\n");
    expect(() => parseProfile(bad)).toThrow();
  });

  it("rejects a malformed grad_date", () => {
    const bad = yamlText.replace('"2027-05"', '"May 2027"');
    expect(() => parseProfile(bad)).toThrow();
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    const bad = yamlText + "extra_field: oops\n";
    expect(() => parseProfile(bad)).toThrow();
  });

  it("parseProfileData validates a plain object the same way", () => {
    expect(parseProfileData({ ...emptyProfileData(), name: "A", email: "a@b.co", phone: "1", school: "S", degree: "D", grad_date: "2027-05", directions: { mle: 1 } }).name).toBe("A");
    expect(() => parseProfileData(emptyProfileData())).toThrow(); // blank required fields
  });

  it("emptyProfileData pre-fills the account's name/email and the truthful defaults", () => {
    const d = emptyProfileData({ name: "Ann", email: "ann@x.y" }) as { name: string; email: string; work_auth: { needs_sponsorship: boolean }; eeo: { gender: string } };
    expect(d.name).toBe("Ann");
    expect(d.email).toBe("ann@x.y");
    expect(d.work_auth.needs_sponsorship).toBe(true);
    expect(d.eeo.gender).toBe("Decline to self-identify");
    for (const f of REQUIRED_PROFILE_FIELDS) expect(f in d).toBe(true);
  });
});
