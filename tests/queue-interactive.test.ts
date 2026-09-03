import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile, Profile } from "@/lib/profile";
import {
  takeNextApplication,
  archiveFromQueue,
  unarchive,
  setPinned,
  pagedQueue,
  pagedAllJobs,
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
});

// A job straight from the scanner: no matches row, no applications row — the population the
// merged /queue page's "全部入库" tab must still show (the old /jobs page listed exactly these).
function seedRawJob(
  db: DB,
  opts: { company?: string; createdAt?: string; visaFlag?: string | null; locFlag?: string | null } = {}
): number {
  return db
    .prepare(
      "INSERT INTO jobs (fingerprint, company, title, apply_url, source, created_at, visa_flag, loc_flag) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(
      `fp-${Math.random()}`,
      opts.company ?? "Raw",
      "SWE",
      "https://raw.example/apply",
      "manual",
      opts.createdAt ?? "2026-01-01 00:00:00",
      opts.visaFlag ?? null,
      opts.locFlag ?? null
    ).lastInsertRowid as number;
}

describe("pagedAllJobs", () => {
  it("lists unscored jobs (no matches/applications) alongside queued ones, flagging queue membership", () => {
    const db = openDb(":memory:");
    const raw = seedRawJob(db, { company: "RawCo" });
    const queued = seedJob(db, { company: "QueuedCo", direction: "swe_general", score: 77 });

    const result = pagedAllJobs(db, { page: 1, pageSize: 25, sort: "score" });

    expect(result.total).toBe(2);
    const rawRow = result.rows.find((r) => r.id === raw)!;
    const queuedRow = result.rows.find((r) => r.id === queued)!;
    expect(rawRow.score).toBeNull();
    expect(rawRow.in_queue).toBe(0);
    expect(queuedRow.score).toBe(77);
    expect(queuedRow.in_queue).toBe(1);
  });

  it("hides visa-flagged and non-US jobs, exactly like the old /jobs listing", () => {
    const db = openDb(":memory:");
    const visible = seedRawJob(db, { company: "Visible" });
    seedRawJob(db, { company: "NoSponsor", visaFlag: "no_sponsor" });
    seedRawJob(db, { company: "Overseas", locFlag: "non_us" });
    seedJob(db, { company: "QueuedOverseas", locFlag: "non_us" });

    const result = pagedAllJobs(db, { page: 1, pageSize: 25, sort: "fresh" });

    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe(visible);
  });

  it("marks archived and parked applications as not in the queue", () => {
    const db = openDb(":memory:");
    const archived = seedJob(db, { company: "Archived", direction: "swe_general" });
    archiveFromQueue(db, archived);

    const result = pagedAllJobs(db, { page: 1, pageSize: 25, sort: "score" });

    expect(result.total).toBe(1);
    expect(result.rows[0].in_queue).toBe(0);
  });

  it("sort=fresh orders by scan time (created_at) descending", () => {
    const db = openDb(":memory:");
    seedRawJob(db, { company: "Old", createdAt: "2026-01-01 00:00:00" });
    seedRawJob(db, { company: "New", createdAt: "2026-03-01 00:00:00" });
    seedJob(db, { company: "Mid", createdAt: "2026-02-01 00:00:00" });

    const result = pagedAllJobs(db, { page: 1, pageSize: 25, sort: "fresh" });

    expect(result.rows.map((r) => r.company)).toEqual(["New", "Mid", "Old"]);
    expect(result.rows[0].created_at).toBe("2026-03-01 00:00:00");
  });

  it("sort=score puts scored jobs first (highest score first) and unscored jobs last", () => {
    const db = openDb(":memory:");
    seedRawJob(db, { company: "Unscored" });
    seedJob(db, { company: "Low", score: 30 });
    seedJob(db, { company: "High", score: 90 });

    const result = pagedAllJobs(db, { page: 1, pageSize: 25, sort: "score" });

    expect(result.rows.map((r) => r.company)).toEqual(["High", "Low", "Unscored"]);
  });

  it("paginates and clamps like pagedQueue", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 30; i++) seedRawJob(db, { company: `Co${i}` });

    const page2 = pagedAllJobs(db, { page: 2, pageSize: 25, sort: "fresh" });
    expect(page2.total).toBe(30);
    expect(page2.pages).toBe(2);
    expect(page2.rows).toHaveLength(5);

    const clamped = pagedAllJobs(db, { page: 99, pageSize: 25, sort: "fresh" });
    expect(clamped.rows).toHaveLength(5);

    expect(pagedAllJobs(openDb(":memory:"), { page: 1, pageSize: 25, sort: "fresh" })).toEqual({
      rows: [],
      total: 0,
      pages: 1,
    });
  });
});
