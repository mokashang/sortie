import { describe, it, expect } from "vitest";
import { describeRun } from "@/app/lib/describe-run";

describe("describeRun", () => {
  it("renders an apply plan with direction labels and modes", () => {
    expect(describeRun("apply", { plan: [{ direction: "swe_general", count: 2 }, { direction: "mle", count: 1, mode: "referral" }] })).toBe(
      "SWE (General) ×2 · MLE / Applied ML · 内推 ×1"
    );
  });
  it("renders a 接力 segment: chain line instead of the resume line, plus the chunk when it caps the plan", () => {
    expect(
      describeRun("apply", { resume: true, plan: [{ direction: "swe_general", count: 60, mode: "direct" }], chunk: 10, chain: { root: 68, step: 2 } })
    ).toBe("接力任务 #68 · 第 2 段 · SWE (General) ×60 · 本段 10 份");
    expect(describeRun("apply", { plan: [{ direction: "swe_general", count: 3, mode: "direct" }], chunk: 10 })).toBe("SWE (General) ×3");
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
