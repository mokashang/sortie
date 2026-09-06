import { describe, it, expect } from "vitest";
import {
  labelOf,
  RUN_STATUS_LABEL,
  EXPERIENCE_KIND_LABEL,
  SPONSORSHIP_LABEL,
  tierLabel,
  modeLabel,
} from "@/app/lib/labels";

describe("ui labels", () => {
  it("maps known keys and falls back for unknown", () => {
    expect(labelOf(RUN_STATUS_LABEL, "running")).toBe("进行中");
    expect(labelOf(RUN_STATUS_LABEL, "bogus")).toBe("—");
    expect(labelOf(RUN_STATUS_LABEL, "bogus", "bogus")).toBe("bogus");
    expect(labelOf(RUN_STATUS_LABEL, null)).toBe("—");
    expect(labelOf(EXPERIENCE_KIND_LABEL, "work")).toBe("工作");
    expect(labelOf(SPONSORSHIP_LABEL, "no")).toBe("不提供签证");
  });
  it("tier and mode labels", () => {
    expect(tierLabel(1)).toBe("梯队 1");
    expect(tierLabel(null)).toBe("未分梯队");
    expect(modeLabel("referral")).toBe("内推");
    expect(modeLabel("direct", 0)).toBe("海投");
    expect(modeLabel("direct", null)).toBe("未判定");
    expect(modeLabel(null)).toBe("未判定");
  });
});
