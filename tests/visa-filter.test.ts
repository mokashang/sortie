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
});
