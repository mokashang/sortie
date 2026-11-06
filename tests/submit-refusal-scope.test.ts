import { describe, it, expect } from "vitest";
import { approvedNotice, IF_SUBMIT_REFUSED } from "@/executor/attended-session";
import { buildAttendedPrompt } from "@/executor/attended";

describe("a refused Submit", () => {
  it("covers that one job: the rest of the approved forms still get their click", () => {
    expect(IF_SUBMIT_REFUSED).toMatch(/covers that one job only/);
    expect(IF_SUBMIT_REFUSED).toMatch(/never report submit_blocked for a job you did not click/);
    expect(approvedNotice(1, "Acme")).toContain(IF_SUBMIT_REFUSED);
  });

  it("still forbids clicking the refused job again or going around the check", () => {
    expect(IF_SUBMIT_REFUSED).toMatch(/do not retry it and do not try another way/);
  });
});

describe("consents", () => {
  it("follow the account's standing answer and stop short of sign-ins and payments", () => {
    const p = buildAttendedPrompt(12);
    expect(p).toContain("custom.application_consents_policy");
    expect(p).toMatch(/登录、建账号、密码、验证码、付款、证件不在其内/);
    expect(p).toMatch(/custom 里没有这一项就照旧报 action 卡/);
  });
});
