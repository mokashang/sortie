import { describe, it, expect } from "vitest";
import { parseProfile, loadProfile } from "@/lib/profile";
import fs from "fs";
import os from "os";
import path from "path";

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

  it("loadProfile accepts an optional file path override", () => {
    const tmpFile = path.join(os.tmpdir(), `profile-test-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, yamlText);
    try {
      const p = loadProfile(tmpFile);
      expect(p.name).toBe("Test User");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
