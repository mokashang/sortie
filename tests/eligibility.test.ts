import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { applyEligibility, archiveCluster, clusterIds, eligibilityFailReason } from "@/apply/eligibility";

function seed(db: DB, fp: string, opts: { status?: string; duplicateOf?: number | null; pinned?: number; withMatch?: boolean } = {}) {
  const info = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, dedup_key) VALUES (?,?,?,?,?)")
    .run(fp, "Acme", "SWE", "greenhouse", "acme|swe");
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO applications (job_id, status, pinned) VALUES (?,?,?)").run(id, opts.status ?? "matched", opts.pinned ?? 0);
  if (opts.duplicateOf) db.prepare("UPDATE jobs SET duplicate_of=? WHERE id=?").run(opts.duplicateOf, id);
  if (opts.withMatch) db.prepare("INSERT INTO matches (job_id, direction, score) VALUES (?,?,?)").run(id, "swe_general", 80);
  return id;
}

describe("eligibilityFailReason", () => {
  it("returns the first failing reason in sponsorship > degree > role order", () => {
    expect(eligibilityFailReason({ sponsorship: "no", degree: "phd_only", role: "non_tech" })).toBe("no sponsorship");
    expect(eligibilityFailReason({ sponsorship: "unknown", degree: "phd_only", role: "eng" })).toBe("PhD only");
    expect(eligibilityFailReason({ sponsorship: "yes", degree: "ms_ok", role: "non_tech" })).toBe("non-engineering role");
    expect(eligibilityFailReason({ sponsorship: "unknown", degree: "ms_ok", role: "eng" })).toBeNull();
  });
});

describe("clusterIds / archiveCluster", () => {
  it("resolves the whole cluster from any member and archives open members with skip_reason", () => {
    const db = openDb(":memory:");
    const main = seed(db, "m", { withMatch: true });
    const d1 = seed(db, "d1", { duplicateOf: main, status: "archived", withMatch: true });
    const d2 = seed(db, "d2", { duplicateOf: main });
    expect(clusterIds(db, d2).sort()).toEqual([main, d1, d2].sort());
    const archived = archiveCluster(db, d2, "no sponsorship");
    expect(archived.sort()).toEqual([main, d2].sort()); // d1 already archived → not counted
    const st = db.prepare("SELECT status FROM applications WHERE job_id=?").get(main) as any;
    expect(st.status).toBe("archived");
    const sk = db.prepare("SELECT skip_reason FROM matches WHERE job_id=?").get(d1) as any;
    expect(sk.skip_reason).toBe("no sponsorship"); // already-archived rows still get the reason
  });

  it("respects pinned rows by default", () => {
    const db = openDb(":memory:");
    const main = seed(db, "m", { pinned: 1 });
    expect(archiveCluster(db, main, "PhD only")).toEqual([]);
    expect(archiveCluster(db, main, "PhD only", { respectPinned: false })).toEqual([main]);
  });
});

describe("applyEligibility", () => {
  it("writes fields, archives on failure, and logs an event with evidence", () => {
    const db = openDb(":memory:");
    const id = seed(db, "a", { withMatch: true });
    const out = applyEligibility(db, { jobId: id, sponsorship: "no", degree: "ms_ok", role: "eng", source: "match_llm", evidence: "We do not sponsor" });
    expect(out).toEqual({ written: true, failReason: "no sponsorship", archivedJobIds: [id] });
    const j = db.prepare("SELECT sponsorship, degree_req, role_kind, elig_source FROM jobs WHERE id=?").get(id) as any;
    expect(j).toEqual({ sponsorship: "no", degree_req: "ms_ok", role_kind: "eng", elig_source: "match_llm" });
    const ev = db.prepare("SELECT kind, payload FROM events WHERE kind='eligibility_fail'").get() as any;
    expect(JSON.parse(ev.payload).evidence).toBe("We do not sponsor");
  });

  it("does not let a lower-priority source overwrite a higher one", () => {
    const db = openDb(":memory:");
    const id = seed(db, "a");
    applyEligibility(db, { jobId: id, sponsorship: "yes", degree: "ms_ok", role: "eng", source: "executor_live" });
    const out = applyEligibility(db, { jobId: id, sponsorship: "no", degree: "ms_ok", role: "eng", source: "match_llm" });
    expect(out.written).toBe(false);
    expect(out.failReason).toBeNull();
    const j = db.prepare("SELECT sponsorship, elig_source FROM jobs WHERE id=?").get(id) as any;
    expect(j).toEqual({ sponsorship: "yes", elig_source: "executor_live" });
  });

  it("archive:false only writes fields", () => {
    const db = openDb(":memory:");
    const id = seed(db, "a");
    const out = applyEligibility(db, { jobId: id, sponsorship: "unknown", degree: "phd_only", role: "eng", source: "jd_review" }, { archive: false });
    expect(out.failReason).toBe("PhD only");
    expect(out.archivedJobIds).toEqual([]);
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(id) as any).status).toBe("matched");
  });
});
