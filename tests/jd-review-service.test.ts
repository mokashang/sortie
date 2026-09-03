import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { nextJdReviewBatch, pendingJdReviewCount, reportJdReview } from "@/jd-review/service";

function seed(db: DB, fp: string, o: { jdStatus?: string | null; status?: string; score?: number; tier?: number; pinned?: number; parked?: string | null; url?: string | null } = {}) {
  const info = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, jd_text, jd_status, apply_url, dedup_key) VALUES (?,?,?,?,?,?,?,?)")
    .run(fp, "Acme", `T-${fp}`, "github_list", "", o.jdStatus === undefined ? "missing" : o.jdStatus, o.url === undefined ? `https://x/${fp}` : o.url, "acme|t");
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO applications (job_id, status, pinned, needs_manual_reason) VALUES (?,?,?,?)").run(id, o.status ?? "matched", o.pinned ?? 0, o.parked ?? null);
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", o.score ?? 50, o.tier ?? 2);
  return id;
}

describe("nextJdReviewBatch / pendingJdReviewCount", () => {
  it("returns only matched, unparked, missing-JD, eligible jobs in queue order, capped by limit", () => {
    const db = openDb(":memory:");
    const low = seed(db, "low", { score: 40 });
    const high = seed(db, "high", { score: 90 });
    const pinned = seed(db, "pin", { score: 10, pinned: 1 });
    seed(db, "rich", { jdStatus: null });
    seed(db, "wall", { jdStatus: "login_wall" });
    seed(db, "parked", { parked: "no apply url" });
    seed(db, "arch", { status: "archived" });
    const dup = seed(db, "dup"); db.prepare("UPDATE jobs SET duplicate_of=? WHERE id=?").run(high, dup);
    expect(pendingJdReviewCount(db)).toBe(3);
    expect(nextJdReviewBatch(db, 2).map((t) => t.jobId)).toEqual([pinned, high]);
    expect(nextJdReviewBatch(db, 10).map((t) => t.jobId)).toEqual([pinned, high, low]);
    expect(nextJdReviewBatch(db, 10)[0]).toMatchObject({ company: "Acme", title: "T-pin", applyUrl: "https://x/pin" });
  });
});

describe("reportJdReview", () => {
  it("reviewed + eligible: stores text, clears match row, requeues as discovered", () => {
    const db = openDb(":memory:");
    const id = seed(db, "a");
    const out = reportJdReview(db, { jobId: id, status: "reviewed", jdText: "Full JD", sponsorship: "unknown", degree: "ms_ok", role: "eng" });
    expect(out).toEqual({ jdStatus: "reviewed", archived: false, skipReason: null, requeued: true });
    const j = db.prepare("SELECT jd_text, jd_status, elig_source FROM jobs WHERE id=?").get(id) as any;
    expect(j).toEqual({ jd_text: "Full JD", jd_status: "reviewed", elig_source: "jd_review" });
    expect(db.prepare("SELECT COUNT(*) n FROM matches WHERE job_id=?").get(id)).toEqual({ n: 0 });
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(id) as any).status).toBe("discovered");
  });

  it("reviewed + failing eligibility: archives with skip_reason, keeps match row", () => {
    const db = openDb(":memory:");
    const id = seed(db, "a");
    const out = reportJdReview(db, { jobId: id, status: "reviewed", jdText: "PhD required", sponsorship: "unknown", degree: "phd_only", role: "eng", evidence: "PhD required" });
    expect(out).toEqual({ jdStatus: "reviewed", archived: true, skipReason: "PhD only", requeued: false });
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(id) as any).status).toBe("archived");
  });

  it("reviewed text that trips the visa regex is archived as 'visa (jd review)'", () => {
    const db = openDb(":memory:");
    const id = seed(db, "a");
    const out = reportJdReview(db, { jobId: id, status: "reviewed", jdText: "We are unable to sponsor visas.", sponsorship: "unknown", degree: "ms_ok", role: "eng" });
    expect(out.skipReason).toBe("visa (jd review)");
    expect((db.prepare("SELECT visa_flag FROM jobs WHERE id=?").get(id) as any).visa_flag).toBe("no_sponsor");
  });

  it("closed archives with 'posting closed'; login_wall/unreachable only set jd_status", () => {
    const db = openDb(":memory:");
    const a = seed(db, "a"); const b = seed(db, "b"); const c = seed(db, "c");
    expect(reportJdReview(db, { jobId: a, status: "closed" })).toMatchObject({ jdStatus: "closed", archived: true, skipReason: "posting closed" });
    expect(reportJdReview(db, { jobId: b, status: "login_wall" })).toEqual({ jdStatus: "login_wall", archived: false, skipReason: null, requeued: false });
    expect(reportJdReview(db, { jobId: c, status: "unreachable" }).jdStatus).toBe("unreachable");
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(b) as any).status).toBe("matched");
    expect(pendingJdReviewCount(db)).toBe(0);
  });

  it("rejects reviewed without jdText or with an unknown status", () => {
    const db = openDb(":memory:");
    const id = seed(db, "a");
    expect(() => reportJdReview(db, { jobId: id, status: "reviewed" })).toThrow(/jdText/);
    expect(() => reportJdReview(db, { jobId: id, status: "bogus" as any })).toThrow(/status/);
  });
});
