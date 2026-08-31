import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { runMatching } from "@/matcher/run";
import { LlmBackend } from "@/llm/types";

function seedJobs(db: ReturnType<typeof openDb>) {
  const ins = db.prepare(
    "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)"
  );
  const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
  const mk = (fp: string, title: string, visa: string | null = null) => {
    const info = ins.run(fp, "Acme", title, "SF", "Do the thing.", "greenhouse", visa);
    insApp.run(info.lastInsertRowid);
    return Number(info.lastInsertRowid);
  };
  return {
    backend: mk("f1", "Backend Engineer New Grad"),
    paralegal: mk("f2", "Paralegal"),
    flagged: mk("f3", "SWE", "no_sponsor"), // visa-flagged → excluded from matching
  };
}

// Fake backend returns a scripted array keyed on the job ids present in the prompt.
function scriptedBackend(scoreByTitle: Record<string, { direction: string | null; score: number; skip: boolean }>): LlmBackend {
  return {
    name: "fake",
    complete: async (req) => {
      const ids = [...req.prompt.matchAll(/<job id="(\d+)"/g)].map((m) => Number(m[1]));
      const titles = [...req.prompt.matchAll(/title: (.+)/g)].map((m) => m[1]);
      const arr = ids.map((id, i) => {
        const s = scoreByTitle[titles[i]] ?? { direction: null, score: 0, skip: true };
        return { job_id: id, direction: s.direction, score: s.score, skip: s.skip, reason: "test" };
      });
      return { text: JSON.stringify(arr), backend: "fake" };
    },
  };
}

describe("runMatching", () => {
  it("scores unmatched non-flagged jobs, writes matches, advances application status", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO profile (key, value) VALUES ('directions', ?)").run(
      JSON.stringify({ swe_backend: 1 })
    );
    const ids = seedJobs(db);
    const backend = scriptedBackend({
      "Backend Engineer New Grad": { direction: "swe_backend", score: 84, skip: false },
      Paralegal: { direction: null, score: 4, skip: true },
    });

    const summary = await runMatching(db, {
      backend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 10,
      threshold: 40,
    });

    expect(summary.scored).toBe(2); // flagged job excluded
    const m = db.prepare("SELECT direction, score, tier, skip_reason FROM matches WHERE job_id=?").get(ids.backend) as any;
    expect(m.score).toBe(84);
    expect(m.direction).toBe("swe_backend");
    expect(m.tier).toBe(1); // from profile directions map
    const appBackend = db.prepare("SELECT status FROM applications WHERE job_id=?").get(ids.backend) as any;
    expect(appBackend.status).toBe("matched");
    // Below threshold OR skip → archived
    const appPara = db.prepare("SELECT status FROM applications WHERE job_id=?").get(ids.paralegal) as any;
    expect(appPara.status).toBe("archived");
    // Flagged job never scored, stays discovered
    const appFlag = db.prepare("SELECT status FROM applications WHERE job_id=?").get(ids.flagged) as any;
    expect(appFlag.status).toBe("discovered");
  });

  it("is resumable: a second run only scores jobs without a match row", async () => {
    const db = openDb(":memory:");
    const ids = seedJobs(db);
    const backend = scriptedBackend({ "Backend Engineer New Grad": { direction: "swe_backend", score: 84, skip: false }, Paralegal: { direction: null, score: 4, skip: true } });
    const opts = { backend, profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } }, batchSize: 10, threshold: 40 };
    await runMatching(db, opts);
    const second = await runMatching(db, opts);
    expect(second.scored).toBe(0);
  });

  it("isolates a batch failure and continues (logs into summary.errors)", async () => {
    const db = openDb(":memory:");
    seedJobs(db);
    const boom: LlmBackend = { name: "boom", complete: async () => { throw new Error("backend down"); } };
    const summary = await runMatching(db, { backend: boom, profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } }, batchSize: 1, threshold: 40 });
    expect(summary.scored).toBe(0);
    expect(summary.errors.length).toBeGreaterThan(0);
  });
});
