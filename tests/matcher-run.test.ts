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
function scriptedBackend(
  scoreByTitle: Record<
    string,
    { direction: string | null; score: number; skip: boolean; sponsorship?: string; degree?: string; role?: string }
  >
): LlmBackend {
  return {
    name: "fake",
    complete: async (req) => {
      const ids = [...req.prompt.matchAll(/<job id="(\d+)"/g)].map((m) => Number(m[1]));
      const titles = [...req.prompt.matchAll(/title: (.+)/g)].map((m) => m[1]);
      const arr = ids.map((id, i) => {
        const s = scoreByTitle[titles[i]] ?? { direction: null, score: 0, skip: true };
        return {
          job_id: id,
          direction: s.direction,
          score: s.score,
          skip: s.skip,
          reason: "test",
          ...(s.sponsorship !== undefined ? { sponsorship: s.sponsorship } : {}),
          ...(s.degree !== undefined ? { degree: s.degree } : {}),
          ...(s.role !== undefined ? { role: s.role } : {}),
        };
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

  it("excludes loc-flagged (non-US) jobs from scoring, mirroring the visa-flag exclusion", async () => {
    const db = openDb(":memory:");
    const ins = db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, loc_flag) VALUES (?,?,?,?,?,?,?)"
    );
    const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
    const info = ins.run("loc1", "Acme", "Backend Engineer New Grad", "London, UK", "Do the thing.", "greenhouse", "non_us");
    const jobId = Number(info.lastInsertRowid);
    insApp.run(jobId);

    const backend: LlmBackend = {
      name: "loc",
      complete: async () => ({
        text: JSON.stringify([{ job_id: jobId, direction: "swe_backend", score: 90, skip: false, reason: "x" }]),
        backend: "loc",
      }),
    };

    const summary = await runMatching(db, {
      backend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 10,
      threshold: 40,
    });

    expect(summary.scored).toBe(0);
    const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(jobId) as any;
    expect(app.status).toBe("discovered");
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

  it("first-occurrence wins when a batch response contains a duplicate job_id (a stray duplicate can't clobber a good score)", async () => {
    const db = openDb(":memory:");
    const ins = db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)"
    );
    const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
    const info = ins.run("dup1", "Acme", "Backend Engineer New Grad", "SF", "Do the thing.", "greenhouse", null);
    const jobId = Number(info.lastInsertRowid);
    insApp.run(jobId);

    const dupBackend: LlmBackend = {
      name: "dup",
      complete: async () => ({
        text: JSON.stringify([
          { job_id: jobId, direction: "swe_backend", score: 84, skip: false, reason: "good" },
          { job_id: jobId, direction: "swe_backend", score: 12, skip: false, reason: "stray duplicate" },
        ]),
        backend: "dup",
      }),
    };

    await runMatching(db, {
      backend: dupBackend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 10,
      threshold: 40,
    });

    const m = db.prepare("SELECT score FROM matches WHERE job_id=?").get(jobId) as any;
    expect(m.score).toBe(84);
    const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(jobId) as any;
    expect(app.status).toBe("matched");
  });

  it("rescoreArchived:true re-scores archived jobs and can rescue an under-scored one", async () => {
    const db = openDb(":memory:");
    const ins = db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)"
    );
    const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
    const info = ins.run("resc1", "Acme", "Backend Engineer New Grad", "SF", "Do the thing.", "greenhouse", null);
    const jobId = Number(info.lastInsertRowid);
    insApp.run(jobId);
    db.prepare("UPDATE applications SET status='archived' WHERE job_id=?").run(jobId);
    db.prepare(
      "INSERT INTO matches (job_id, direction, score, tier, reason, skip_reason) VALUES (?,?,?,?,?,?)"
    ).run(jobId, "swe_backend", 20, 1, "old reason", "low score (20)");

    const rescueBackend: LlmBackend = {
      name: "rescue",
      complete: async () => ({
        text: JSON.stringify([{ job_id: jobId, direction: "swe_backend", score: 80, skip: false, reason: "better calibration" }]),
        backend: "rescue",
      }),
    };
    const opts = {
      backend: rescueBackend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 10,
      threshold: 40,
    };

    // Default (rescoreArchived unset/false): the archived job already has a match row, so it's
    // never revisited by the resumable gate.
    const untouched = await runMatching(db, opts);
    expect(untouched.scored).toBe(0);
    const stillOld = db.prepare("SELECT score FROM matches WHERE job_id=?").get(jobId) as any;
    expect(stillOld.score).toBe(20);

    // rescoreArchived:true rescues it.
    const summary = await runMatching(db, { ...opts, rescoreArchived: true });
    expect(summary.scored).toBe(1);
    const m = db.prepare("SELECT score, direction FROM matches WHERE job_id=?").get(jobId) as any;
    expect(m.score).toBe(80);
    const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(jobId) as any;
    expect(app.status).toBe("matched");
  });

  it("sets skip_reason to a low-score message when archived purely by threshold (skip=false)", async () => {
    const db = openDb(":memory:");
    const ids = seedJobs(db);
    const backend = scriptedBackend({
      "Backend Engineer New Grad": { direction: "swe_backend", score: 84, skip: false },
      Paralegal: { direction: "swe_backend", score: 20, skip: false }, // below threshold, model didn't set skip
    });

    await runMatching(db, {
      backend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 10,
      threshold: 40,
    });

    const m = db.prepare("SELECT skip_reason FROM matches WHERE job_id=?").get(ids.paralegal) as any;
    expect(m.skip_reason).toBe("low score (20)");
  });

  it("only counts matched/archived when the application status actually changed", async () => {
    const db = openDb(":memory:");
    const ins = db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)"
    );
    const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
    const info = ins.run("sub1", "Acme", "Backend Engineer New Grad", "SF", "Do the thing.", "greenhouse", null);
    const jobId = Number(info.lastInsertRowid);
    insApp.run(jobId);
    db.prepare("UPDATE applications SET status='submitted' WHERE job_id=?").run(jobId);

    const backend: LlmBackend = {
      name: "sub",
      complete: async () => ({
        text: JSON.stringify([{ job_id: jobId, direction: "swe_backend", score: 80, skip: false, reason: "x" }]),
        backend: "sub",
      }),
    };

    const summary = await runMatching(db, {
      backend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 10,
      threshold: 40,
    });

    expect(summary.scored).toBe(1);
    expect(summary.matched).toBe(0);
    const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(jobId) as any;
    expect(app.status).toBe("submitted");
    const m = db.prepare("SELECT score FROM matches WHERE job_id=?").get(jobId) as any;
    expect(m.score).toBe(80);
  });

  it("concurrency=3 runs multiple batches in flight and still scores every job correctly", async () => {
    const db = openDb(":memory:");
    const ins = db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)"
    );
    const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
    const jobIds: number[] = [];
    for (let i = 0; i < 6; i++) {
      const info = ins.run(`conc${i}`, "Acme", `Job ${i}`, "SF", "Do the thing.", "greenhouse", null);
      const id = Number(info.lastInsertRowid);
      insApp.run(id);
      jobIds.push(id);
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const backend: LlmBackend = {
      name: "concurrent",
      complete: async (req) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const ids = [...req.prompt.matchAll(/<job id="(\d+)"/g)].map((m) => Number(m[1]));
        // Small delay so overlapping calls actually overlap instead of resolving synchronously.
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        const arr = ids.map((id) => ({ job_id: id, direction: "swe_backend", score: 80, skip: false, reason: "ok" }));
        return { text: JSON.stringify(arr), backend: "concurrent" };
      },
    };

    const summary = await runMatching(db, {
      backend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 1,
      threshold: 40,
      concurrency: 3,
    });

    expect(summary.scored).toBe(6);
    expect(maxInFlight).toBeGreaterThan(1);
    for (const id of jobIds) {
      const m = db.prepare("SELECT score, direction FROM matches WHERE job_id=?").get(id) as any;
      expect(m.score).toBe(80);
      expect(m.direction).toBe("swe_backend");
      const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(id) as any;
      expect(app.status).toBe("matched");
    }
  });

  it("concurrency=3 produces identical results to concurrency=1 for the same scripted inputs", async () => {
    function seedSix(db: ReturnType<typeof openDb>) {
      const ins = db.prepare(
        "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)"
      );
      const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
      const ids: number[] = [];
      for (let i = 0; i < 6; i++) {
        const info = ins.run(`par${i}`, "Acme", `Job ${i}`, "SF", "Do the thing.", "greenhouse", null);
        const id = Number(info.lastInsertRowid);
        insApp.run(id);
        ids.push(id);
      }
      return ids;
    }

    function makeBackend(): LlmBackend {
      return {
        name: "parity",
        complete: async (req) => {
          const ids = [...req.prompt.matchAll(/<job id="(\d+)"/g)].map((m) => Number(m[1]));
          await new Promise((resolve) => setTimeout(resolve, 5));
          const arr = ids.map((id, i) => ({
            job_id: id,
            direction: i % 2 === 0 ? "swe_backend" : null,
            score: i % 2 === 0 ? 84 : 10,
            skip: i % 2 !== 0,
            reason: "parity",
          }));
          return { text: JSON.stringify(arr), backend: "parity" };
        },
      };
    }

    const dbSeq = openDb(":memory:");
    const seqIds = seedSix(dbSeq);
    const seqSummary = await runMatching(dbSeq, {
      backend: makeBackend(),
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 1,
      threshold: 40,
      concurrency: 1,
    });

    const dbPar = openDb(":memory:");
    const parIds = seedSix(dbPar);
    const parSummary = await runMatching(dbPar, {
      backend: makeBackend(),
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 1,
      threshold: 40,
      concurrency: 3,
    });

    expect(parSummary.scored).toBe(seqSummary.scored);
    expect(parSummary.matched).toBe(seqSummary.matched);
    expect(parSummary.archived).toBe(seqSummary.archived);
    expect(parSummary.errors.length).toBe(seqSummary.errors.length);

    for (let i = 0; i < seqIds.length; i++) {
      const seqM = db2Match(dbSeq, seqIds[i]);
      const parM = db2Match(dbPar, parIds[i]);
      expect(parM).toEqual(seqM);
    }

    function db2Match(db: ReturnType<typeof openDb>, jobId: number) {
      const m = db.prepare("SELECT direction, score, tier, skip_reason FROM matches WHERE job_id=?").get(jobId) as any;
      const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(jobId) as any;
      return { score: m.score, direction: m.direction, tier: m.tier, skip_reason: m.skip_reason, status: app.status };
    }
  });

  it("under concurrency>1, a batch failure is still isolated and other batches succeed", async () => {
    const db = openDb(":memory:");
    const ins = db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)"
    );
    const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");
    const jobIds: number[] = [];
    for (let i = 0; i < 5; i++) {
      const info = ins.run(`fail${i}`, "Acme", `Job ${i}`, "SF", "Do the thing.", "greenhouse", null);
      const id = Number(info.lastInsertRowid);
      insApp.run(id);
      jobIds.push(id);
    }
    // The third job (batch index 2, when batchSize=1) will throw.
    const failingId = jobIds[2];

    const backend: LlmBackend = {
      name: "flaky",
      complete: async (req) => {
        const ids = [...req.prompt.matchAll(/<job id="(\d+)"/g)].map((m) => Number(m[1]));
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (ids.includes(failingId)) throw new Error("backend down for this batch");
        const arr = ids.map((id) => ({ job_id: id, direction: "swe_backend", score: 84, skip: false, reason: "ok" }));
        return { text: JSON.stringify(arr), backend: "flaky" };
      },
    };

    const summary = await runMatching(db, {
      backend,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
      batchSize: 1,
      threshold: 40,
      concurrency: 3,
    });

    expect(summary.errors.length).toBe(1);
    expect(summary.scored).toBe(4);
    for (const id of jobIds) {
      if (id === failingId) {
        const m = db.prepare("SELECT id FROM matches WHERE job_id=?").get(id);
        expect(m).toBeUndefined();
        const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(id) as any;
        expect(app.status).toBe("discovered");
      } else {
        const m = db.prepare("SELECT score FROM matches WHERE job_id=?").get(id) as any;
        expect(m.score).toBe(84);
      }
    }
  });

  it("archives on eligibility failure with the specific skip_reason and writes jobs fields", async () => {
    const db = openDb(":memory:");
    const ids = seedJobs(db);
    const backend = scriptedBackend({
      "Backend Engineer New Grad": { direction: "swe_backend", score: 84, skip: false, degree: "phd_only" },
      Paralegal: { direction: null, score: 60, skip: false, role: "non_tech" },
    });
    await runMatching(db, { backend, profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } } });
    const m = db.prepare("SELECT skip_reason FROM matches WHERE job_id=?").get(ids.backend) as any;
    expect(m.skip_reason).toBe("PhD only");
    const j = db.prepare("SELECT degree_req, elig_source FROM jobs WHERE id=?").get(ids.backend) as any;
    expect(j).toEqual({ degree_req: "phd_only", elig_source: "match_llm" });
    const p = db.prepare("SELECT skip_reason FROM matches WHERE job_id=?").get(ids.paralegal) as any;
    expect(p.skip_reason).toBe("non-engineering role");
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(ids.backend) as any).status).toBe("archived");
  });

  it("skips duplicate rows entirely", async () => {
    const db = openDb(":memory:");
    const ids = seedJobs(db);
    db.prepare("UPDATE jobs SET duplicate_of=? WHERE id=?").run(ids.backend, ids.paralegal);
    const backend = scriptedBackend({ "Backend Engineer New Grad": { direction: "swe_backend", score: 84, skip: false } });
    const s = await runMatching(db, { backend, profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } } });
    expect(s.scored).toBe(1);
  });

  it("rescoreMatched re-scores matched rich-JD rows, archives only on eligibility failure, never on low score, never pinned", async () => {
    const db = openDb(":memory:");
    const ids = seedJobs(db);
    db.prepare("INSERT INTO matches (job_id, direction, score) VALUES (?,?,?)").run(ids.backend, "swe_backend", 80);
    db.prepare("INSERT INTO matches (job_id, direction, score) VALUES (?,?,?)").run(ids.paralegal, "swe_backend", 80);
    db.prepare("UPDATE applications SET status='matched' WHERE job_id IN (?,?)").run(ids.backend, ids.paralegal);
    db.prepare("UPDATE applications SET pinned=1 WHERE job_id=?").run(ids.paralegal);
    const backend = scriptedBackend({
      "Backend Engineer New Grad": { direction: "swe_backend", score: 20, skip: true },       // low score → stays matched
      Paralegal: { direction: null, score: 10, skip: true, role: "non_tech" },                 // fails but pinned → stays
    });
    const s = await runMatching(db, { backend, rescoreMatched: true, profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } } });
    expect(s.scored).toBe(2);
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(ids.backend) as any).status).toBe("matched");
    expect((db.prepare("SELECT score FROM matches WHERE job_id=?").get(ids.backend) as any).score).toBe(20);
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(ids.paralegal) as any).status).toBe("matched");
    expect((db.prepare("SELECT role_kind FROM jobs WHERE id=?").get(ids.paralegal) as any).role_kind).toBe("non_tech");
  });

  it("never touches status for a pinned row in normal mode either, even when eligibility fails via rescoreArchived", async () => {
    const db = openDb(":memory:");
    const ids = seedJobs(db);
    // Give the paralegal an existing match row + archived status + pinned, so rescoreArchived's
    // "OR a.status = 'archived'" clause is what makes it eligible for this (normal, not
    // rescoreMatched) scoring pass.
    db.prepare("INSERT INTO matches (job_id, direction, score) VALUES (?,?,?)").run(ids.paralegal, "swe_backend", 80);
    db.prepare("UPDATE applications SET status='archived', pinned=1 WHERE job_id=?").run(ids.paralegal);
    const backend = scriptedBackend({
      "Backend Engineer New Grad": { direction: "swe_backend", score: 84, skip: false },
      Paralegal: { direction: null, score: 60, skip: false, role: "non_tech" },
    });
    const s = await runMatching(db, {
      backend,
      rescoreArchived: true,
      profile: { directions: { swe_backend: 1 }, work_auth: { status: "F-1", needs_sponsorship: true } },
    });
    expect(s.scored).toBe(2);
    // Pinned → the matcher must not flip status at all, not even from 'archived' to 'matched'
    // just because the (failed) eligibility check declined to re-archive it.
    const app = db.prepare("SELECT status FROM applications WHERE job_id=?").get(ids.paralegal) as any;
    expect(app.status).toBe("archived");
    const j = db.prepare("SELECT role_kind FROM jobs WHERE id=?").get(ids.paralegal) as any;
    expect(j.role_kind).toBe("non_tech");
    const m = db.prepare("SELECT skip_reason FROM matches WHERE job_id=?").get(ids.paralegal) as any;
    expect(m.skip_reason).toBe("non-engineering role");
  });
});
