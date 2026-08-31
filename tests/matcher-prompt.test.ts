import { describe, it, expect } from "vitest";
import { buildMatchPrompt, MatchResultSchema, parseMatchResults } from "@/matcher/prompt";

const profile = {
  directions: { swe_backend: 1, ai_infra: 1, quant: 1, embedded: 2 } as Record<string, number>,
  work_auth: { status: "F-1", needs_sponsorship: true },
};
const jobs = [
  { id: 1, company: "Acme", title: "Backend Engineer, New Grad", location: "SF", jdText: "Build distributed services in Go." },
  { id: 2, company: "Zoo", title: "Litigation Paralegal", location: "NY", jdText: "Support attorneys with case filings." },
];

describe("match prompt", () => {
  it("includes each job id, the candidate directions, and asks for strict JSON", () => {
    const p = buildMatchPrompt(profile, jobs);
    expect(p.prompt).toContain("Acme");
    expect(p.prompt).toContain("1");
    expect(p.prompt).toContain("swe_backend");
    expect(p.prompt).toMatch(/json/i);
    expect(p.system).toMatch(/recruiter|matching|career/i);
    // JD text is untrusted data — the prompt must fence it and instruct the model to treat it as data.
    expect(p.prompt).toMatch(/treat .* as data|do not follow|untrusted/i);
  });

  it("schema accepts a well-formed result and rejects a bad score", () => {
    const good = { job_id: 1, direction: "swe_backend", score: 82, skip: false, reason: "Strong backend match." };
    expect(MatchResultSchema.parse(good).score).toBe(82);
    expect(() => MatchResultSchema.parse({ ...good, score: 150 })).toThrow();
  });

  it("parseMatchResults tolerates unknown direction by nulling it and flagging skip", () => {
    const parsed = parseMatchResults(
      JSON.stringify([{ job_id: 2, direction: "astrology", score: 5, skip: true, reason: "Not technical." }])
    );
    expect(parsed[0].direction).toBeNull();
    expect(parsed[0].skip).toBe(true);
  });
});
