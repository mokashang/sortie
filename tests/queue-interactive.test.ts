import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile, Profile } from "@/lib/profile";
import {
  takeNextApplication,
  archiveFromQueue,
  unarchive,
  setPinned,
  pagedQueue,
  queueByDirection,
  UNCLASSIFIED_DIRECTION,
  ApplyTask,
} from "@/apply/queue";

const baseYaml = `
name: Mengjia Shang
email: shangmengjiajiajia@gmail.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/mengjia-shang
github: github.com/mokashang
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1
  needs_sponsorship: true
targets:
  primary: newgrad
  secondary: intern
directions:
  swe_general: 1
  ai_infra: 1
daily_minutes_budget: 90
`;

function testProfile(): Profile {
  return parseProfile(baseYaml);
}

function seedJob(
  db: DB,
  opts: {
    fingerprint?: string;
    company?: string;
    title?: string;
    location?: string | null;
    applyUrl?: string;
    ats?: string;
    tier?: number | null;
    score?: number;
    direction?: string | null;
    status?: string;
    createdAt?: string;
    postedAt?: string | null;
    updatedAt?: string;
    locFlag?: string | null;
    pinned?: number;
    reason?: string | null;
  } = {}
): number {
  const jobId = db
    .prepare(
      "INSERT INTO jobs (fingerprint, company, title, location, apply_url, ats, source, created_at, posted_at, loc_flag) VALUES (?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      opts.fingerprint ?? `fp-${Math.random()}`,
      opts.company ?? "Acme",
      opts.title ?? "SWE",
      opts.location ?? null,
      opts.applyUrl ?? "https://acme.example/apply",
      opts.ats ?? "greenhouse",
      "manual",
      opts.createdAt ?? "2026-01-01 00:00:00",
      opts.postedAt ?? null,
      opts.locFlag ?? null
    ).lastInsertRowid as number;

  db.prepare("INSERT INTO matches (job_id, direction, score, tier, reason) VALUES (?,?,?,?,?)").run(
    jobId,
    opts.direction === undefined ? "ai_infra" : opts.direction,
    opts.score ?? 80,
    opts.tier === undefined ? 1 : opts.tier,
    opts.reason ?? null
  );

  const cols = ["job_id", "status"];
  const vals: unknown[] = [jobId, opts.status ?? "matched"];
  if (opts.updatedAt) {
    cols.push("updated_at");
    vals.push(opts.updatedAt);
  }
  if (opts.pinned !== undefined) {
    cols.push("pinned");
    vals.push(opts.pinned);
  }
  db.prepare(
    `INSERT INTO applications (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
  ).run(...(vals as []));

  return jobId;
}

function seedResume(
  db: DB,
  versionName: string,
  directions: string[],
  pdfPath = "/data/r/x.pdf",
  compiledAt = "2026-01-01 00:00:00"
): number {
  return db
    .prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)")
    .run(versionName, JSON.stringify(directions), pdfPath, compiledAt).lastInsertRowid as number;
}

function getApplication(db: DB, jobId: number) {
  return db.prepare("SELECT * FROM applications WHERE job_id=?").get(jobId) as Record<string, unknown>;
}

describe("archiveFromQueue", () => {
  it("archives a matched job: status -> archived, needs_manual_reason set", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "matched" });

    archiveFromQueue(db, jobId);

    const row = getApplication(db, jobId);
    expect(row.status).toBe("archived");
    expect(row.needs_manual_reason).toBe("user skipped from queue");
  });

  it("throws when the application is not currently 'matched' (e.g. already prepared)", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "prepared" });

    expect(() => archiveFromQueue(db, jobId)).toThrow();
    expect(getApplication(db, jobId).status).toBe("prepared");
  });

  it("throws for an unknown jobId", () => {
    const db = openDb(":memory:");
    expect(() => archiveFromQueue(db, 999)).toThrow();
  });
});

describe("unarchive", () => {
  it("restores an archived job to matched and clears needs_manual_reason", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "matched" });
    archiveFromQueue(db, jobId);

    unarchive(db, jobId);

    const row = getApplication(db, jobId);
    expect(row.status).toBe("matched");
    expect(row.needs_manual_reason).toBeNull();
  });

  it("throws when the application is not currently 'archived'", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "matched" });

    expect(() => unarchive(db, jobId)).toThrow();
  });

  it("throws for an unknown jobId", () => {
    const db = openDb(":memory:");
    expect(() => unarchive(db, 999)).toThrow();
  });
});

describe("setPinned", () => {
  it("sets pinned=1 on a job", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, {});

    setPinned(db, jobId, true);

    expect(getApplication(db, jobId).pinned).toBe(1);
  });

  it("unsets pinned back to 0", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { pinned: 1 });

    setPinned(db, jobId, false);

    expect(getApplication(db, jobId).pinned).toBe(0);
  });

  it("throws for an unknown jobId", () => {
    const db = openDb(":memory:");
    expect(() => setPinned(db, 999, true)).toThrow();
  });
});

describe("takeNextApplication with pinned rows", () => {
  it("takes a pinned row before a higher-tier/higher-score unpinned row", () => {
    const db = openDb(":memory:");
    seedResume(db, "ai_infra-v1", ["ai_infra"]);
    const unpinnedTopPriority = seedJob(db, { company: "TopCo", tier: 1, score: 99 });
    const pinnedLowerPriority = seedJob(db, { company: "PinnedCo", tier: 3, score: 1, pinned: 1 });
    void unpinnedTopPriority;

    const result = takeNextApplication(db, testProfile()) as ApplyTask;

    expect(result.jobId).toBe(pinnedLowerPriority);
  });

  it("with opts.direction, still takes the pinned row first within that direction", () => {
    const db = openDb(":memory:");
    seedResume(db, "quant-v1", ["quant"]);
    const unpinned = seedJob(db, { company: "A", direction: "quant", tier: 1, score: 99 });
    const pinned = seedJob(db, { company: "B", direction: "quant", tier: 2, score: 1, pinned: 1 });
    void unpinned;

    const result = takeNextApplication(db, testProfile(), { direction: "quant" }) as ApplyTask;

    expect(result.jobId).toBe(pinned);
  });
});

describe("pagedQueue", () => {
  it("returns rows/total/pages for a direction, 25 per page by default math", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 30; i++) {
      seedJob(db, { company: `Co${i}`, direction: "swe_general", tier: 1, score: 50 + i });
    }

    const page1 = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "score" });
    expect(page1.total).toBe(30);
    expect(page1.pages).toBe(2);
    expect(page1.rows).toHaveLength(25);
    // score DESC: highest score (79) first.
    expect(page1.rows[0].score).toBe(79);

    const page2 = pagedQueue(db, { direction: "swe_general", page: 2, pageSize: 25, sort: "score" });
    expect(page2.rows).toHaveLength(5);
  });

  it("sorts pinned rows first regardless of the chosen sort", () => {
    const db = openDb(":memory:");
    seedJob(db, { company: "HighScore", direction: "swe_general", tier: 1, score: 99 });
    const pinnedLow = seedJob(db, { company: "PinnedLow", direction: "swe_general", tier: 9, score: 1, pinned: 1 });

    const result = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "score" });

    expect(result.rows[0].id).toBe(pinnedLow);
  });

  it("sort=company orders alphabetically by company name", () => {
    const db = openDb(":memory:");
    seedJob(db, { company: "Zeta", direction: "swe_general", score: 10 });
    seedJob(db, { company: "Alpha", direction: "swe_general", score: 90 });
    seedJob(db, { company: "Mid", direction: "swe_general", score: 50 });

    const result = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "company" });

    expect(result.rows.map((r) => r.company)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("sort=fresh orders by posted_at descending, freshest first", () => {
    const db = openDb(":memory:");
    seedJob(db, { company: "Old", direction: "swe_general", postedAt: "2026-01-01" });
    seedJob(db, { company: "New", direction: "swe_general", postedAt: "2026-03-01" });
    seedJob(db, { company: "Mid", direction: "swe_general", postedAt: "2026-02-01" });

    const result = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "fresh" });

    expect(result.rows.map((r) => r.company)).toEqual(["New", "Mid", "Old"]);
  });

  it("excludes archived/loc-flagged jobs and jobs outside the requested direction", () => {
    const db = openDb(":memory:");
    const good = seedJob(db, { company: "Good", direction: "swe_general" });
    const archived = seedJob(db, { company: "Archived", direction: "swe_general" });
    archiveFromQueue(db, archived);
    seedJob(db, { company: "NonUs", direction: "swe_general", locFlag: "non_us" });
    seedJob(db, { company: "OtherDir", direction: "quant" });

    const result = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "score" });

    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe(good);
  });

  it("clamps an out-of-range page to the valid range instead of returning nothing/erroring", () => {
    const db = openDb(":memory:");
    seedJob(db, { company: "Only", direction: "swe_general" });

    const result = pagedQueue(db, { direction: "swe_general", page: 99, pageSize: 25, sort: "score" });

    expect(result.rows).toHaveLength(1);
    expect(result.pages).toBe(1);
  });

  it("returns empty rows/total 0/pages 1 for a direction with nothing matched", () => {
    const db = openDb(":memory:");
    const result = pagedQueue(db, { direction: "nonexistent_dir", page: 1, pageSize: 25, sort: "score" });
    expect(result).toEqual({ rows: [], total: 0, pages: 1 });
  });

  it("the UNCLASSIFIED_DIRECTION sentinel matches NULL-direction jobs, not a literal string", () => {
    const db = openDb(":memory:");
    const noDir = seedJob(db, { company: "NoDir", direction: null });
    seedJob(db, { company: "Tiered", direction: "quant" });

    const result = pagedQueue(db, { direction: UNCLASSIFIED_DIRECTION, page: 1, pageSize: 25, sort: "score" });

    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe(noDir);
  });

  it("pagedQueue rows carry dup_count and jd_status", () => {
    const db = openDb(":memory:");
    const main = seedJob(db, { fingerprint: "m", title: "SWE" });
    const d1 = seedJob(db, { fingerprint: "d1", title: "SWE" });
    const d2 = seedJob(db, { fingerprint: "d2", title: "SWE" });
    db.prepare("UPDATE jobs SET duplicate_of=? WHERE id IN (?,?)").run(main, d1, d2);
    db.prepare("UPDATE jobs SET jd_status='missing' WHERE id=?").run(main);
    const page = pagedQueue(db, { direction: "ai_infra", page: 1, pageSize: 25, sort: "score" });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ id: main, dup_count: 2, jd_status: "missing" });
  });
});

describe("QUEUE_ELIGIBLE_SQL", () => {
  it("hides duplicate, no-sponsor, phd-only and non-tech jobs from pagedQueue and takeNextApplication", () => {
    const db = openDb(":memory:");
    seedResume(db, "ai_infra-v1", ["ai_infra"]);
    const ok = seedJob(db, { fingerprint: "ok", title: "SWE A" });
    const dup = seedJob(db, { fingerprint: "dup", title: "SWE B" });
    const nos = seedJob(db, { fingerprint: "nos", title: "SWE C" });
    const phd = seedJob(db, { fingerprint: "phd", title: "SWE D" });
    const sales = seedJob(db, { fingerprint: "sales", title: "SWE E" });
    db.prepare("UPDATE jobs SET duplicate_of=? WHERE id=?").run(ok, dup);
    db.prepare("UPDATE jobs SET sponsorship='no' WHERE id=?").run(nos);
    db.prepare("UPDATE jobs SET degree_req='phd_only' WHERE id=?").run(phd);
    db.prepare("UPDATE jobs SET role_kind='non_tech' WHERE id=?").run(sales);
    const page = pagedQueue(db, { direction: "ai_infra", page: 1, pageSize: 25, sort: "score" });
    expect(page.rows.map((r) => r.id)).toEqual([ok]);
    const groups = queueByDirection(db);
    expect(groups[0].matched).toBe(1);

    // Prove the same QUEUE_ELIGIBLE_SQL filter applies to the actual picker, not just the
    // read-only queue views: takeNextApplication must surface only the one eligible job, and
    // report `done: true` once it's been taken — never reach into the duplicate/no-sponsor/
    // phd-only/non-tech rows the queue view also hides.
    const result = takeNextApplication(db, testProfile()) as ApplyTask;
    expect(result.jobId).toBe(ok);
    const next = takeNextApplication(db, testProfile());
    expect(next).toEqual({ done: true });
  });
});
