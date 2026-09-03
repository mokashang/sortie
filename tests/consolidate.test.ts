import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { LlmBackend } from "@/llm/types";
import { runConsolidate, pendingGroupKeys, pickCanonical } from "@/scanner/consolidate";
import { buildConsolidatePrompt, parseConsolidateResults, rankLocation } from "@/scanner/consolidate-prompt";

function seed(db: DB, fp: string, o: { company?: string; title?: string; location?: string | null; jd?: string; source?: string; status?: string; locFlag?: string | null } = {}) {
  const company = o.company ?? "Acme", title = o.title ?? "SWE Intern";
  const info = db.prepare(
    "INSERT INTO jobs (fingerprint, company, title, location, jd_text, source, dedup_key, loc_flag) VALUES (?,?,?,?,?,?,?,?)"
  ).run(fp, company, title, o.location ?? "Austin, TX", o.jd ?? "", o.source ?? "github_list", `${company.toLowerCase()}|${title.toLowerCase()}`, o.locFlag ?? null);
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(id, o.status ?? "matched");
  return id;
}
const clustersBackend = (fn: (ids: number[]) => number[][]): LlmBackend => ({
  name: "fake",
  complete: async (req) => {
    const keys = [...req.prompt.matchAll(/<group key="([^"]+)">/g)].map((m) => m[1]);
    const out = keys.map((key) => {
      const block = req.prompt.split(`<group key="${key}">`)[1].split("</group>")[0];
      const ids = [...block.matchAll(/id=(\d+)/g)].map((m) => Number(m[1]));
      return { key, clusters: fn(ids) };
    });
    return { text: JSON.stringify(out), backend: "fake" };
  },
});

describe("rankLocation", () => {
  it("prefers LA, then SF/Bay Area, then NY, then others", () => {
    expect(rankLocation("Los Angeles, CA")).toBe(0);
    expect(rankLocation("San Francisco, CA")).toBe(1);
    expect(rankLocation("New York, NY")).toBe(2);
    expect(rankLocation("Austin, TX")).toBe(3);
    expect(rankLocation(null)).toBe(3);
  });
});

describe("pendingGroupKeys", () => {
  it("returns keys with >=2 US rows and at least one unjudged row", () => {
    const db = openDb(":memory:");
    seed(db, "a"); seed(db, "b");
    seed(db, "c", { company: "Solo" });
    seed(db, "d", { company: "Judged" }); seed(db, "e", { company: "Judged" });
    db.prepare("UPDATE jobs SET dedup_judged_at='2026-01-01' WHERE company='Judged'").run();
    expect(pendingGroupKeys(db)).toEqual(["acme|swe intern"]);
  });
});

describe("pickCanonical", () => {
  it("prefers in-flight application, then LA>SF>NY, then rich JD, then ATS source, then lowest id", () => {
    const db = openDb(":memory:");
    const austin = seed(db, "a", { location: "Austin, TX", jd: "rich", source: "greenhouse" });
    const la = seed(db, "b", { location: "Los Angeles, CA" });
    expect(pickCanonical(db, [austin, la])).toBe(la);
    const submitted = seed(db, "c", { location: "Boston, MA", status: "submitted" });
    expect(pickCanonical(db, [austin, la, submitted])).toBe(submitted);
    const sf1 = seed(db, "d", { location: "SF" }); const sf2 = seed(db, "e", { location: "San Francisco", jd: "rich" });
    expect(pickCanonical(db, [sf1, sf2])).toBe(sf2);
    const ny1 = seed(db, "f", { location: "NYC", source: "github_list" }); const ny2 = seed(db, "g", { location: "New York", source: "lever" });
    expect(pickCanonical(db, [ny1, ny2])).toBe(ny2);
  });
});

describe("runConsolidate", () => {
  it("archives non-canonical rows with duplicate_of and skip_reason, stamps dedup_judged_at", async () => {
    const db = openDb(":memory:");
    const a = seed(db, "a", { location: "Austin, TX" }); const b = seed(db, "b", { location: "Los Angeles, CA" }); const c = seed(db, "c", { location: "Denver, CO" });
    db.prepare("INSERT INTO matches (job_id, score) VALUES (?, 70)").run(a);
    const s = await runConsolidate(db, { backend: clustersBackend((ids) => [ids]) });
    expect(s).toMatchObject({ groups: 1, clusters: 1, archived: 2, errors: [] });
    const rows = db.prepare("SELECT j.id, j.duplicate_of, j.dedup_judged_at, a.status FROM jobs j JOIN applications a ON a.job_id=j.id ORDER BY j.id").all() as any[];
    expect(rows.find((r) => r.id === b)).toMatchObject({ duplicate_of: null, status: "matched" });
    expect(rows.find((r) => r.id === a)).toMatchObject({ duplicate_of: b, status: "archived" });
    expect(rows.find((r) => r.id === c)).toMatchObject({ duplicate_of: b, status: "archived" });
    expect(rows.every((r) => r.dedup_judged_at)).toBe(true);
    expect((db.prepare("SELECT skip_reason FROM matches WHERE job_id=?").get(a) as any).skip_reason).toBe(`duplicate of #${b}`);
    expect(pendingGroupKeys(db)).toEqual([]);
  });

  it("keeps separate clusters separate and ignores foreign/missing ids", async () => {
    const db = openDb(":memory:");
    const a = seed(db, "a"); const b = seed(db, "b"); const c = seed(db, "c");
    const s = await runConsolidate(db, { backend: clustersBackend((ids) => [[ids[0], 99999], [ids[1]]]) }); // c omitted
    expect(s.archived).toBe(0);
    const cRow = db.prepare("SELECT dedup_judged_at FROM jobs WHERE id=?").get(c) as any;
    expect(cRow.dedup_judged_at).toBeNull(); // omitted → stays pending
    expect((db.prepare("SELECT dedup_judged_at FROM jobs WHERE id=?").get(a) as any).dedup_judged_at).not.toBeNull();
    expect(pendingGroupKeys(db)).toEqual(["acme|swe intern"]);
  });

  it("re-judging a group with a new row only adds links, never un-archives", async () => {
    const db = openDb(":memory:");
    const main = seed(db, "a", { location: "Los Angeles, CA" }); const old = seed(db, "b");
    db.prepare("UPDATE jobs SET duplicate_of=?, dedup_judged_at='2026-01-01' WHERE id=?").run(main, old);
    db.prepare("UPDATE jobs SET dedup_judged_at='2026-01-01' WHERE id=?").run(main);
    db.prepare("UPDATE applications SET status='archived' WHERE job_id=?").run(old);
    const fresh = seed(db, "c");
    // model (wrongly) says old row is its own cluster now — we must not un-archive it
    await runConsolidate(db, { backend: clustersBackend((ids) => [[main, fresh], [old]]) });
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(old) as any).duplicate_of).toBe(main);
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(old) as any).status).toBe("archived");
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(fresh) as any).duplicate_of).toBe(main);
  });

  it("leaves the batch unjudged when the backend throws", async () => {
    const db = openDb(":memory:");
    seed(db, "a"); seed(db, "b");
    const s = await runConsolidate(db, { backend: { name: "boom", complete: async () => { throw new Error("boom"); } } });
    expect(s.errors).toHaveLength(1);
    expect(pendingGroupKeys(db)).toEqual(["acme|swe intern"]);
  });

  it("does not demote an established canonical", async () => {
    const db = openDb(":memory:");
    const p = seed(db, "p", { location: "Austin, TX" });
    const q = seed(db, "q");
    db.prepare("UPDATE jobs SET duplicate_of=?, dedup_judged_at='2026-01-01' WHERE id=?").run(p, q);
    db.prepare("UPDATE jobs SET dedup_judged_at='2026-01-01' WHERE id=?").run(p);
    db.prepare("UPDATE applications SET status='archived' WHERE job_id=?").run(q);
    const s = seed(db, "s", { location: "Los Angeles, CA" });
    // model puts the established canonical P together with a new row S — S should join P,
    // but P must not be demoted even though pickCanonical([p,s]) would otherwise prefer S (LA).
    await runConsolidate(db, { backend: clustersBackend(() => [[p, s], [q]]) });
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(p) as any).duplicate_of).toBeNull();
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(s) as any).duplicate_of).toBe(p);
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(q) as any).duplicate_of).toBe(p);
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(s) as any).status).toBe("archived");
    expect((db.prepare("SELECT status FROM applications WHERE job_id=?").get(p) as any).status).toBe("matched");
  });

  it("never merges two established clusters", async () => {
    const db = openDb(":memory:");
    const p1 = seed(db, "p1");
    const d1 = seed(db, "d1");
    db.prepare("UPDATE jobs SET duplicate_of=?, dedup_judged_at='2026-01-01' WHERE id=?").run(p1, d1);
    db.prepare("UPDATE jobs SET dedup_judged_at='2026-01-01' WHERE id=?").run(p1);
    db.prepare("UPDATE applications SET status='archived' WHERE job_id=?").run(d1);
    const p2 = seed(db, "p2");
    const d2 = seed(db, "d2");
    db.prepare("UPDATE jobs SET duplicate_of=?, dedup_judged_at='2026-01-01' WHERE id=?").run(p2, d2);
    db.prepare("UPDATE jobs SET dedup_judged_at='2026-01-01' WHERE id=?").run(p2);
    db.prepare("UPDATE applications SET status='archived' WHERE job_id=?").run(d2);
    const n = seed(db, "n");
    // model (wrongly) merges the two established canonicals with a new row, and splits their
    // duplicates into their own cluster — neither established cluster may be merged/split.
    await runConsolidate(db, { backend: clustersBackend(() => [[p1, p2, n], [d1, d2]]) });
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(p1) as any).duplicate_of).toBeNull();
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(p2) as any).duplicate_of).toBeNull();
    const min = Math.min(p1, p2);
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(n) as any).duplicate_of).toBe(min);
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(d1) as any).duplicate_of).toBe(p1);
    expect((db.prepare("SELECT duplicate_of FROM jobs WHERE id=?").get(d2) as any).duplicate_of).toBe(p2);
  });
});

describe("consolidate prompt", () => {
  it("fences each group and row, escapes angle brackets, parses clusters", () => {
    const req = buildConsolidatePrompt([{ key: "k", rows: [{ id: 1, location: "SF", posted_at: null, source: "greenhouse", ats: "greenhouse", url_tail: "boards.greenhouse.io/x/jobs/1", jd_len: 10, jd_excerpt: "<b>hi</b>", cluster: null }] }]);
    expect(req.prompt).toContain('<group key="k">');
    expect(req.prompt).toContain("id=1");
    expect(req.prompt).not.toContain("<b>hi</b>");
    expect(req.tier).toBe("fast");
    expect(parseConsolidateResults('[{"key":"k","clusters":[[1,2],[3]]}]')).toEqual([{ key: "k", clusters: [[1, 2], [3]] }]);
  });

  it("escapes scraped fields", () => {
    const req = buildConsolidatePrompt([{ key: "k", rows: [{ id: 1, location: "<x>", posted_at: null, source: "greenhouse", ats: null, url_tail: "u", jd_len: 0, jd_excerpt: "", cluster: null }] }]);
    expect(req.prompt).toContain("&lt;x&gt;");
    expect(req.prompt).not.toContain("<x>");
  });
});
