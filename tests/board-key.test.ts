import { describe, it, expect } from "vitest";
import { parseBoard, atsFromUrl } from "@/scanner/board-key";

describe("parseBoard", () => {
  const cases: [string, string | null][] = [
    ["https://boards.greenhouse.io/stripe/jobs/8128744", "greenhouse:stripe"],
    ["https://job-boards.greenhouse.io/scaleai/jobs/4730836005", "greenhouse:scaleai"],
    ["https://boards.greenhouse.io/embed/job_app?for=Datadog&token=8052095", "greenhouse:datadog"],
    ["https://jobs.lever.co/palantir/e500bcf3-19d8-4d3c-b340-4d76e", "lever:palantir"],
    ["https://jobs.ashbyhq.com/openai/1234-5678", "ashby:openai"],
    ["https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/DFT_JR2016865", "workday:nvidia.wd5/NVIDIAExternalCareerSite"],
    ["https://bah.wd1.myworkdayjobs.com/en-US/BAH_Jobs/details/Software-Engineer_R0000", "workday:bah.wd1/BAH_Jobs"],
    ["https://rtx.wd5.myworkdaysite.com/recruiting/rtx/rec_rtx_ext_gateway/job/x/y", "workday:rtx.wd5/rec_rtx_ext_gateway"],
    ["https://jobs.smartrecruiters.com/ServiceNow/744000147650939-staff-engineer", "smartrecruiters:ServiceNow"],
    ["https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/26012889", "oracle:egug.fa.us2.oraclecloud.com/CX_1"],
    ["https://careers-sig.icims.com/jobs/11098/application-support-engineer/job", "icims:careers-sig.icims.com"],
    ["https://apply.workable.com/thorlabs/j/D406CD014E/", "workable:thorlabs"],
    ["https://lifeattiktok.com/search/7669691374918011141", "bytedance:tiktok"],
    ["https://jobs.bytedance.com/en/position/766969/detail", "bytedance:bytedance"],
    ["https://www.amazon.jobs/en/jobs/10530257/sde", "amazon:us"],
    ["https://www.linkedin.com/jobs/view/4463654152/", "linkedin:guest"],
    ["https://www.tesla.com/careers/search/job/x-123", "chrome:tesla"],
    ["https://usc.joinhandshake.com/stu/jobs/123", "chrome:handshake"],
    ["https://careers.roblox.com/jobs/8123?gh_jid=8123", null],
    ["https://nvidia.wd5.myworkdayjobs.com/", null],
    ["not a url", null],
  ];
  for (const [url, key] of cases) it(`${url} → ${key}`, () => expect(parseBoard(url)?.key ?? null).toBe(key));

  it("normalizes greenhouse/lever/ashby idents to lowercase but keeps smartrecruiters/workday case", () => {
    expect(parseBoard("https://boards.greenhouse.io/Datadog/jobs/1")!.ident).toBe("datadog");
    expect(parseBoard("https://jobs.smartrecruiters.com/WesternDigital/1")!.ident).toBe("WesternDigital");
  });
});

describe("atsFromUrl", () => {
  it("returns the ats even when no board can be derived", () => {
    expect(atsFromUrl("https://careers.roblox.com/jobs/8123?gh_jid=8123")).toBe("greenhouse");
    expect(atsFromUrl("https://qualcomm.eightfold.ai/careers/job/446704474013")).toBe("eightfold");
    expect(atsFromUrl("https://jobs.l3harris.com/job/x")).toBeNull();
    expect(atsFromUrl("https://www.linkedin.com/jobs/view/1/")).toBeNull();
    expect(atsFromUrl("https://boards.greenhouse.io/stripe/jobs/1")).toBe("greenhouse");
  });
});
