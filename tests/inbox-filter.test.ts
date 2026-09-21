import { describe, it, expect } from "vitest";
import { companyPhrases, isCandidateMail, normalizeName, RECRUITING_SUBJECT } from "@/inbox/filter";

describe("inbox/filter companyPhrases", () => {
  it("keeps distinctive names, drops generic suffixes and short tokens", () => {
    expect(companyPhrases(["Datadog, Inc.", "Scale AI", "Jane Street Capital", "The Trade Desk", "X", "AI Labs"])).toEqual([
      "datadog",
      "scale",
      "jane street",
      "jane",
      "trade desk",
      "trade",
    ]);
    expect(normalizeName("  Blue Origin — LLC ")).toBe("blue origin llc");
  });
});

describe("inbox/filter isCandidateMail", () => {
  const companies = ["Datadog", "Scale AI", "Stripe"];

  it("passes ATS senders, company mentions and recruiting subjects; drops the rest", () => {
    expect(isCandidateMail({ from: "no-reply@greenhouse.io", subject: "hello", text: "" }, companies)).toMatchObject({ keep: true, reason: "ats" });
    expect(isCandidateMail({ from: "talent@us-east.mail.lever.co", subject: "hello", text: "" }, companies)).toMatchObject({ keep: true, reason: "ats" });
    expect(isCandidateMail({ from: "someone@example.com", subject: "Following up", text: "Thanks for your interest in Stripe's new grad program." }, companies)).toMatchObject({
      keep: true,
      reason: "company",
      company: "stripe",
    });
    expect(isCandidateMail({ from: "someone@example.com", subject: "Interview availability", text: "" }, companies)).toMatchObject({ keep: true, reason: "subject" });
    expect(isCandidateMail({ from: "news@substack.com", subject: "This week in Rust", text: "A newsletter about crates." }, companies)).toEqual({ keep: false, reason: "none" });
  });

  it("matches company names on word boundaries only", () => {
    expect(isCandidateMail({ from: "a@b.com", subject: "Fruit", text: "pineapple stripes and datadogs" }, ["Apple", "Stripe", "Datadog"]).keep).toBe(false);
    expect(isCandidateMail({ from: "a@b.com", subject: "Fruit", text: "from Apple's team" }, ["Apple"]).keep).toBe(true);
  });

  it("does not treat job-alert senders as ATS", () => {
    expect(isCandidateMail({ from: "jobs-noreply@linkedin.com", subject: "12 new jobs for you", text: "" }, companies).keep).toBe(false);
    expect(RECRUITING_SUBJECT.test("Your order has shipped")).toBe(false);
    expect(RECRUITING_SUBJECT.test("Update on your application")).toBe(true);
  });
});
