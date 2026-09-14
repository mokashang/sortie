import { describe, it, expect } from "vitest";
import { describeRun } from "@/app/lib/describe-run";

describe("describeRun", () => {
  it("renders an apply plan with direction labels and modes", () => {
    const plan = { plan: [{ direction: "swe_general", count: 2 }, { direction: "mle", count: 1, mode: "referral" }] };
    expect(describeRun("apply", plan, "zh")).toBe("SWE (General) ×2 · MLE / Applied ML · 内推 ×1");
    expect(describeRun("apply", plan, "en")).toBe("SWE (General) ×2 · MLE / Applied ML · referral ×1");
  });
  it("renders a 接力 segment: chain line instead of the resume line, plus the chunk when it caps the plan", () => {
    expect(
      describeRun("apply", { resume: true, plan: [{ direction: "swe_general", count: 60, mode: "direct" }], chunk: 10, chain: { root: 68, step: 2 } }, "zh")
    ).toBe("接力任务 #68 · 第 2 段 · SWE (General) ×60 · 本段 10 份");
    expect(describeRun("apply", { plan: [{ direction: "swe_general", count: 3, mode: "direct" }], chunk: 10 }, "zh")).toBe("SWE (General) ×3");
  });
  it("renders resume, limit, jobIds and companies", () => {
    expect(describeRun("apply", { resume: true }, "zh")).toBe("恢复模式:补提交已批准的申请");
    expect(describeRun("apply", { resume: true }, "en")).toBe("Resume mode: submit the approved applications");
    expect(describeRun("jd_review", { limit: 40 }, "zh")).toBe("前 40 个");
    expect(describeRun("jd_review", { limit: 40 }, "en")).toBe("first 40");
    expect(describeRun("apply", { jobIds: [12, 13], mode: "referral" }, "zh")).toBe("找内推 · 岗位 #12, #13");
    expect(describeRun("apply", { jobIds: [12, 13], mode: "referral" }, "en")).toBe("Find referrals · jobs #12, #13");
    expect(describeRun("network_find", { companies: ["Stripe", "Datadog"] }, "zh")).toBe("Stripe, Datadog");
    expect(describeRun("scan", {}, "zh")).toBe("");
    expect(describeRun("scan", "garbage", "en")).toBe("");
  });
});
