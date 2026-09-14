import { describe, it, expect } from "vitest";
import { labelOf, labelsFor, tierLabel, modeLabel, directionName } from "@/app/lib/labels";

describe("ui labels", () => {
  it("maps known keys and falls back for unknown", () => {
    const zh = labelsFor("zh");
    const en = labelsFor("en");
    expect(labelOf(zh.runStatus, "running")).toBe("进行中");
    expect(labelOf(en.runStatus, "running")).toBe("Running");
    expect(labelOf(zh.runStatus, "bogus")).toBe("—");
    expect(labelOf(zh.runStatus, "bogus", "bogus")).toBe("bogus");
    expect(labelOf(zh.runStatus, null)).toBe("—");
    expect(labelOf(zh.experienceKind, "work")).toBe("工作");
    expect(labelOf(en.experienceKind, "work")).toBe("Work");
    expect(labelOf(zh.sponsorship, "no")).toBe("不提供签证");
    expect(labelOf(en.sponsorship, "no")).toBe("No sponsorship");
  });
  it("tier and mode labels", () => {
    expect(tierLabel(1, "zh")).toBe("梯队 1");
    expect(tierLabel(1, "en")).toBe("Tier 1");
    expect(tierLabel(null, "zh")).toBe("未分梯队");
    expect(tierLabel(null, "en")).toBe("No tier");
    expect(modeLabel("referral", undefined, "zh")).toBe("内推");
    expect(modeLabel("referral", undefined, "en")).toBe("Referral");
    expect(modeLabel("direct", 0, "zh")).toBe("海投");
    expect(modeLabel("direct", 0, "en")).toBe("Direct");
    expect(modeLabel("direct", null, "zh")).toBe("未判定");
    expect(modeLabel(null, undefined, "zh")).toBe("未判定");
    expect(modeLabel(null, undefined, "en")).toBe("Undecided");
  });
  it("direction names use the catalogue label and fall back to 未分类 / Unclassified", () => {
    expect(directionName("swe_general", "zh")).toBe("SWE (General)");
    expect(directionName("swe_general", "en")).toBe("SWE (General)");
    expect(directionName(null, "zh")).toBe("未分类");
    expect(directionName(undefined, "en")).toBe("Unclassified");
    expect(directionName("未分类", "en")).toBe("Unclassified");
  });
});
