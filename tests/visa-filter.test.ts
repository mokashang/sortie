import { describe, it, expect } from "vitest";
import { visaFlag } from "@/scanner/visa-filter";

describe("visaFlag", () => {
  it("flags explicit no-sponsorship", () => {
    expect(visaFlag("We are unable to sponsor visas for this role")).toBe("no_sponsor");
    expect(visaFlag("Will not sponsor employment visa now or in the future")).toBe("no_sponsor");
    expect(visaFlag("This position is not eligible for visa sponsorship")).toBe("no_sponsor");
  });
  it("flags citizen/green-card-only", () => {
    expect(visaFlag("Applicants must be U.S. citizens")).toBe("citizen_only");
    expect(visaFlag("US Citizenship or Green Card required")).toBe("citizen_only");
  });
  it("flags clearance requirements", () => {
    expect(visaFlag("Active TS/SCI security clearance required")).toBe("clearance");
  });
  it("returns null for silent or friendly JDs", () => {
    expect(visaFlag("We welcome candidates of all backgrounds")).toBeNull();
    expect(visaFlag("")).toBeNull();
    expect(visaFlag("Visa sponsorship available")).toBeNull();
    // 模糊表述不误杀(用户策略:只跳过明确拒绝)
    expect(visaFlag("Must be authorized to work in the US")).toBeNull();
  });

  it("accepts nullable/undefined input and returns null", () => {
    expect(visaFlag(null)).toBeNull();
    expect(visaFlag(undefined)).toBeNull();
  });

  it("flags additional common no-sponsorship phrasings", () => {
    expect(visaFlag("We are not able to provide visa sponsorship")).toBe("no_sponsor");
    expect(visaFlag("We do not provide sponsorship for employment visas")).toBe("no_sponsor");
    expect(visaFlag("We do not offer visa sponsorship at this time")).toBe("no_sponsor");
    expect(visaFlag("This role is not eligible for employment visa sponsorship")).toBe("no_sponsor");
    expect(visaFlag("We are unable to provide sponsorship now or in the future")).toBe("no_sponsor");
    expect(visaFlag("Must be authorized to work in the U.S. without sponsorship")).toBe("no_sponsor");
  });

  it("does not flag clearance for JDs that explicitly do NOT require clearance", () => {
    expect(visaFlag("No security clearance is required")).toBeNull();
    expect(visaFlag("This role does not require a security clearance")).toBeNull();
    expect(visaFlag("Ability to obtain a security clearance is a plus")).toBeNull();
    expect(visaFlag("Preference given to candidates with an active clearance")).toBeNull();
  });

  it("flags clearance for JDs that require the ability to obtain one", () => {
    expect(visaFlag("Must be able to obtain a security clearance")).toBe("clearance");
  });

  it("prioritizes no_sponsor over citizen_only and clearance when multiple apply", () => {
    expect(
      visaFlag("Applicants must be U.S. citizens. We are unable to sponsor visas for this role.")
    ).toBe("no_sponsor");
  });
});
