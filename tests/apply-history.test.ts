import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { reportFill } from "@/apply/queue";
import {
  POST_SUBMIT_STAGES,
  setStage,
  applicationHistory,
  todaySubmitted,
  archiveManual,
} from "@/apply/history";

function seedJob(
  db: DB,
  opts: {
    company?: string;
    title?: string;
    direction?: string | null;
    status?: string;
    submittedAt?: string; // sqlite UTC datetime
    reason?: string | null;
    applyUrl?: string | null;
  } = {}
): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, opts.company ?? "Acme", opts.title ?? "SWE", opts.applyUrl ?? "https://acme.example/apply", "manual")
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(
    jobId,
    opts.direction === undefined ? "swe_general" : opts.direction,
    80,
    1
  );
  db.prepare("INSERT INTO applications (job_id, status, submitted_at, needs_manual_reason) VALUES (?,?,?,?)").run(
    jobId,
    opts.status ?? "matched",
    opts.submittedAt ?? null,
    opts.reason ?? null
  );
  return jobId;
}

function app(db: DB, jobId: number) {
  return db.prepare("SELECT * FROM applications WHERE job_id=?").get(jobId) as Record<string, unknown>;
}

describe("setStage (manual status tracking on /history)", () => {
  it("moves a submitted application through oa -> interview -> offer and logs an event per step", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    setStage(db, jobId, "oa");
    expect(app(db, jobId).status).toBe("oa");
    setStage(db, jobId, "interview", "phone screen 9/10");
    expect(app(db, jobId).status).toBe("interview");
    setStage(db, jobId, "offer");
    expect(app(db, jobId).status).toBe("offer");

    const events = db
      .prepare("SELECT payload FROM events WHERE kind='application_stage' AND entity_id=? ORDER BY id")
      .all(jobId) as { payload: string }[];
    expect(events.map((e) => JSON.parse(e.payload))).toEqual([
      { from: "submitted", to: "oa", note: null },
      { from: "oa", to: "interview", note: "phone screen 9/10" },
      { from: "interview", to: "offer", note: null },
    ]);
  });

  it("allows moving backwards (a mis-click) and to rejected/stale", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "interview", submittedAt: "2026-09-01 10:00:00" });
    setStage(db, jobId, "submitted");
    expect(app(db, jobId).status).toBe("submitted");
    setStage(db, jobId, "rejected");
    expect(app(db, jobId).status).toBe("rejected");
    setStage(db, jobId, "stale");
    expect(app(db, jobId).status).toBe("stale");
  });

  it("refuses an unknown stage and refuses to touch a not-yet-submitted application", () => {
    const db = openDb(":memory:");
    const submitted = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    expect(() => setStage(db, submitted, "matched")).toThrow();
    expect(() => setStage(db, submitted, "archived")).toThrow();

    const matched = seedJob(db, { status: "matched" });
    expect(() => setStage(db, matched, "oa")).toThrow();
    const awaiting = seedJob(db, { status: "awaiting_confirm" });
    expect(() => setStage(db, awaiting, "oa")).toThrow();
    expect(() => setStage(db, 9999, "oa")).toThrow();
  });

  it("exposes the stage list in pipeline order", () => {
    expect(POST_SUBMIT_STAGES).toEqual([
      "submitted",
      "oa",
      "interview",
      "offer",
      "offer_accepted",
      "offer_declined",
      "rejected",
      "stale",
    ]);
  });

  it("moves an offer to accepted / declined", () => {
    const db = openDb(":memory:");
    const a = seedJob(db, { status: "offer", submittedAt: "2026-09-01 10:00:00" });
    setStage(db, a, "offer_accepted");
    expect(app(db, a).status).toBe("offer_accepted");
    const b = seedJob(db, { status: "offer", submittedAt: "2026-09-01 10:00:00" });
    setStage(db, b, "offer_declined");
    expect(app(db, b).status).toBe("offer_declined");
  });
});

describe("applicationHistory", () => {
  it("returns only post-submit applications, newest submission first, with direction and local times", () => {
    const db = openDb(":memory:");
    seedJob(db, { status: "matched" });
    seedJob(db, { status: "awaiting_confirm" });
    seedJob(db, { status: "archived", reason: "user skipped" });
    const older = seedJob(db, { company: "Old", status: "submitted", submittedAt: "2026-08-20 10:00:00", direction: "mle" });
    const newer = seedJob(db, { company: "New", status: "oa", submittedAt: "2026-09-02 03:00:00" });
    const rejected = seedJob(db, { company: "Rej", status: "rejected", submittedAt: "2026-08-25 10:00:00", direction: null });

    const rows = applicationHistory(db);
    expect(rows.map((r) => r.jobId)).toEqual([newer, rejected, older]);
    expect(rows[0]).toMatchObject({ company: "New", status: "oa", direction: "swe_general" });
    expect(rows[1].direction).toBeNull();
    // submittedAt is rendered in the server's local timezone as YYYY-MM-DD HH:MM
    expect(rows[2].submittedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(rows[2].submittedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[2].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("carries the most recent stage note when one was recorded", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    expect(applicationHistory(db)[0].lastNote).toBeNull();
    setStage(db, jobId, "interview", "onsite 9/20");
    expect(applicationHistory(db)[0].lastNote).toBe("onsite 9/20");
  });
});

describe("applicationHistory peak (furthest stage ever reached)", () => {
  it("derives peak from the current status when there are no stage events (pre-existing rows)", () => {
    const db = openDb(":memory:");
    const submitted = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    const interview = seedJob(db, { status: "interview", submittedAt: "2026-09-01 10:00:00" });
    const stale = seedJob(db, { status: "stale", submittedAt: "2026-09-01 10:00:00" });
    const declined = seedJob(db, { status: "offer_declined", submittedAt: "2026-09-01 10:00:00" });
    const peaks = new Map(applicationHistory(db).map((r) => [r.jobId, r.peak]));
    expect(peaks.get(submitted)).toBe("submitted");
    expect(peaks.get(interview)).toBe("interview");
    expect(peaks.get(stale)).toBe("submitted");
    expect(peaks.get(declined)).toBe("offer");
  });

  it("remembers the furthest stage from the event timeline after a rejection or a backwards move", () => {
    const db = openDb(":memory:");
    const afterInterview = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    setStage(db, afterInterview, "oa");
    setStage(db, afterInterview, "interview");
    setStage(db, afterInterview, "rejected");

    const afterOa = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    setStage(db, afterOa, "oa");
    setStage(db, afterOa, "stale");

    const misclick = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    setStage(db, misclick, "offer");
    setStage(db, misclick, "oa"); // corrected back down: the offer never really happened

    const peaks = new Map(applicationHistory(db).map((r) => [r.jobId, r.peak]));
    expect(peaks.get(afterInterview)).toBe("interview");
    expect(peaks.get(afterOa)).toBe("oa");
    // A backwards correction still leaves the higher 'to' in the log; the peak is the max of the
    // timeline and the current status, so this row reads as having reached offer. Documented
    // limitation: the user should re-check the row rather than us guessing which click was wrong.
    expect(peaks.get(misclick)).toBe("offer");
  });
});

describe("todaySubmitted (local-midnight boundary)", () => {
  it("counts an application submitted just now and excludes one submitted yesterday (local)", () => {
    const db = openDb(":memory:");
    const now = seedJob(db, { company: "Now", status: "submitted" });
    db.prepare("UPDATE applications SET submitted_at = datetime('now') WHERE job_id=?").run(now);
    const yesterday = seedJob(db, { company: "Yday", status: "submitted" });
    db.prepare("UPDATE applications SET submitted_at = datetime('now','-1 day') WHERE job_id=?").run(yesterday);
    const advanced = seedJob(db, { company: "Adv", status: "oa" });
    db.prepare("UPDATE applications SET submitted_at = datetime('now') WHERE job_id=?").run(advanced);

    const rows = todaySubmitted(db);
    expect(rows.map((r) => r.company).sort()).toEqual(["Adv", "Now"]);
  });

  it("uses the local calendar day, not the UTC day", () => {
    const db = openDb(":memory:");
    // A row stamped 'start of today local, expressed in UTC' must count; one second before must not.
    const a = seedJob(db, { company: "Edge", status: "submitted" });
    db.prepare(
      "UPDATE applications SET submitted_at = datetime(date('now','localtime'), 'utc') WHERE job_id=?"
    ).run(a);
    const b = seedJob(db, { company: "Before", status: "submitted" });
    db.prepare(
      "UPDATE applications SET submitted_at = datetime(date('now','localtime'), 'utc', '-1 second') WHERE job_id=?"
    ).run(b);
    expect(todaySubmitted(db).map((r) => r.company)).toEqual(["Edge"]);
  });
});

describe("archiveManual (remove from the needs-manual list)", () => {
  it("archives parked rows in batch, keeping the original reason for audit", () => {
    const db = openDb(":memory:");
    const a = seedJob(db, { status: "matched", reason: "login wall" });
    const b = seedJob(db, { status: "matched", reason: "error: tab crashed" });
    const c = seedJob(db, { status: "matched", reason: "captcha" });
    const result = archiveManual(db, [a, b]);
    expect(result).toEqual({ archived: 2, skipped: [] });
    expect(app(db, a).status).toBe("archived");
    expect(app(db, a).needs_manual_reason).toBe("login wall");
    expect(app(db, b).status).toBe("archived");
    expect(app(db, c).status).toBe("matched");
  });

  it("skips rows that are not parked (unparked matched, submitted, awaiting_confirm) and reports them", () => {
    const db = openDb(":memory:");
    const parked = seedJob(db, { status: "matched", reason: "x" });
    const clean = seedJob(db, { status: "matched" });
    const sub = seedJob(db, { status: "submitted", submittedAt: "2026-09-01 10:00:00" });
    const result = archiveManual(db, [parked, clean, sub, 4242]);
    expect(result.archived).toBe(1);
    expect(result.skipped.sort()).toEqual([clean, sub, 4242].sort());
    expect(app(db, clean).status).toBe("matched");
    expect(app(db, sub).status).toBe("submitted");
  });
});

describe("reportFill with archive (live-page hard ineligibility)", () => {
  it("archives the job instead of parking it, and archives same company+title duplicates still in the queue", () => {
    const db = openDb(":memory:");
    const target = seedJob(db, { company: "Google", title: "Software Engineer Intern", status: "prepared" });
    const dup1 = seedJob(db, { company: "Google", title: "Software Engineer Intern", status: "matched" });
    const dup2 = seedJob(db, { company: "google", title: "Software Engineer Intern", status: "matched" }); // case-insensitive
    const other = seedJob(db, { company: "Google", title: "Site Reliability Engineer", status: "matched" });
    const dupSubmitted = seedJob(db, { company: "Google", title: "Software Engineer Intern", status: "submitted", submittedAt: "2026-09-01 10:00:00" });

    reportFill(db, { jobId: target, status: "needs_manual", reason: "PhD-only (live page)", archive: true });

    expect(app(db, target).status).toBe("archived");
    expect(app(db, target).needs_manual_reason).toBe("PhD-only (live page)");
    expect(app(db, dup1).status).toBe("archived");
    expect(app(db, dup1).needs_manual_reason).toBe(`duplicate of job ${target}: PhD-only (live page)`);
    expect(app(db, dup2).status).toBe("archived");
    expect(app(db, other).status).toBe("matched");
    expect(app(db, dupSubmitted).status).toBe("submitted");
  });

  it("without archive, needs_manual still parks at matched (unchanged behaviour)", () => {
    const db = openDb(":memory:");
    const target = seedJob(db, { status: "prepared" });
    reportFill(db, { jobId: target, status: "needs_manual", reason: "captcha" });
    expect(app(db, target).status).toBe("matched");
    expect(app(db, target).needs_manual_reason).toBe("captcha");
  });
});
