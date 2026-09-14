import { describe, it, expect } from "vitest";
import { describeRun } from "@/app/lib/describe-run";

describe("describeRun", () => {
  it("renders an apply plan with direction labels and modes", () => {
    const plan = { plan: [{ direction: "swe_general", count: 2 }, { direction: "mle", count: 1, mode: "referral" }] };
    expect(describeRun("apply", plan, "zh")).toBe("SWE (General) ×2 · MLE / Applied ML · 内推 ×1");
    expect(describeRun("apply", plan, "en")).toBe("SWE (General) ×2 · MLE / Applied ML · referral ×1");
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
