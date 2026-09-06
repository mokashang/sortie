import { describe, it, expect } from "vitest";
import { describeRun } from "@/app/lib/describe-run";

describe("describeRun", () => {
  it("renders an apply plan with direction labels and modes", () => {
    expect(describeRun("apply", { plan: [{ direction: "swe_general", count: 2 }, { direction: "mle", count: 1, mode: "referral" }] })).toBe(
      "SWE (General) ×2 · MLE / Applied ML · 内推 ×1"
    );
  });
  it("renders resume, limit, jobIds and companies", () => {
    expect(describeRun("apply", { resume: true })).toBe("恢复模式:补提交已批准的申请");
    expect(describeRun("jd_review", { limit: 40 })).toBe("前 40 个");
    expect(describeRun("apply", { jobIds: [12, 13], mode: "referral" })).toBe("找内推 · 岗位 #12, #13");
    expect(describeRun("network_find", { companies: ["Stripe", "Datadog"] })).toBe("Stripe, Datadog");
    expect(describeRun("scan", {})).toBe("");
    expect(describeRun("scan", "garbage")).toBe("");
  });
});
