import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { buildReferralFitPrompt, parseReferralFitResults, runReferralFit, countUnclassified } from "@/matcher/referral-fit";
import { LlmBackend } from "@/llm/types";

function seed(db: DB, company: string, title: string, score: number, status = "matched"): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
    .run(`fp-${Math.random()}`, company, title, "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "swe_general", score, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, status);
  return jobId;
}

function scripted(fitByCompany: Record<string, boolean>): LlmBackend {
  return {
    name: "fake",
    complete: async (req) => {
      const items = [...req.prompt.matchAll(/<job id="(\d+)" company="([^"]*)"/g)];
      const arr = items.map((m) => ({ job_id: Number(m[1]), referral_fit: fitByCompany[m[2]] ?? false, reason: "test" }));
      return { text: JSON.stringify(arr), backend: "fake" };
    },
  };
}

describe("matcher/referral-fit", () => {
  it("prompt carries the rule (score >= 75 AND well-known company) and company/title/score per job, no JD", () => {
    const req = buildReferralFitPrompt([{ id: 1, company: "Google", title: "SWE New Grad", direction: "swe_general", score: 88 }]);
    expect(req.system).toMatch(/75/);
    expect(req.system).toMatch(/well-known|big tech|unicorn/i);
    expect(req.prompt).toContain('<job id="1" company="Google"');
    expect(req.prompt).toContain("score: 88");
    expect(req.prompt).not.toMatch(/description:/);
    expect(req.tier).toBe("fast");
  });

  it("parse drops malformed items and keeps referral_fit boolean", () => {
    const out = parseReferralFitResults(
      '[{"job_id":1,"referral_fit":true,"reason":"big"},{"job_id":"x"},{"job_id":2,"referral_fit":false,"reason":"small"}]'
    );
    expect(out).toEqual([
      { job_id: 1, referral_fit: true, reason: "big" },
      { job_id: 2, referral_fit: false, reason: "small" },
    ]);
  });

  it("runReferralFit classifies only matched+unclassified rows and writes referral_fit/reason", async () => {
    const db = openDb(":memory:");
    const g = seed(db, "Google", "SWE", 90);
    const s = seed(db, "TinyCo", "SWE", 90);
    const archived = seed(db, "Meta", "SWE", 90, "archived");
    const done = seed(db, "Amazon", "SWE", 90);
    db.prepare("UPDATE matches SET referral_fit = 0 WHERE job_id = ?").run(done);
    expect(countUnclassified(db)).toBe(2);

    const summary = await runReferralFit(db, { backend: scripted({ Google: true, TinyCo: false, Meta: true }), batchSize: 10 });
    expect(summary.classified).toBe(2);
    expect(summary.referral).toBe(1);
    const fit = (id: number) =>
      db.prepare("SELECT referral_fit, referral_reason FROM matches WHERE job_id = ?").get(id) as {
        referral_fit: number | null;
        referral_reason: string | null;
      };
    expect(fit(g)).toEqual({ referral_fit: 1, referral_reason: "test" });
    expect(fit(s).referral_fit).toBe(0);
    expect(fit(archived).referral_fit).toBeNull();
    expect(countUnclassified(db)).toBe(0);
  });

  it("a failing batch is reported, not thrown", async () => {
    const db = openDb(":memory:");
    seed(db, "Google", "SWE", 90);
    const backend: LlmBackend = { name: "bad", complete: async () => ({ text: "not json", backend: "bad" }) };
    const summary = await runReferralFit(db, { backend });
    expect(summary.errors.length).toBe(1);
    expect(countUnclassified(db)).toBe(1);
  });
});
