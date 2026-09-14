import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import {
  upsertPerson,
  listPeople,
  createOutreach,
  appendThread,
  listOutreach,
  setOutreachStatus,
  outreachJobIds,
  outreachForJob,
  outreachesForJobs,
} from "@/network/crm";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

function db(): DB {
  return openDb(":memory:");
}

describe("upsertPerson", () => {
  it("creates a new person and returns its id", () => {
    const d = db();
    const id = upsertPerson(d, U, { name: "Jane Doe", relation: "recruiter" });
    expect(id).toBeGreaterThan(0);
    const people = listPeople(d, U);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ id, name: "Jane Doe", relation: "recruiter" });
  });

  it("is idempotent on linkedin_url and fills gaps without overwriting existing fields", () => {
    const d = db();
    const id1 = upsertPerson(d, U, { name: "Jane Doe", linkedin_url: "in/janedoe" });
    // Second call with the same linkedin_url but new company/role info fills the gaps.
    const id2 = upsertPerson(d, U, {
      name: "Jane Doe",
      linkedin_url: "in/janedoe",
      company: "Acme",
      role_title: "Recruiter",
    });
    expect(id2).toBe(id1);
    let people = listPeople(d, U);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ company: "Acme", role_title: "Recruiter" });

    // Third call tries to overwrite already-filled company — existing value wins.
    const id3 = upsertPerson(d, U, {
      name: "Jane Doe",
      linkedin_url: "in/janedoe",
      company: "OtherCo",
    });
    expect(id3).toBe(id1);
    people = listPeople(d, U);
    expect(people[0].company).toBe("Acme");
  });

  it("notes: stored on insert, a fresh non-empty observation replaces the old one, empty/missing leaves it", () => {
    const d = db();
    const id = upsertPerson(d, U, { name: "Jane Doe", linkedin_url: "in/janedoe", notes: "  Runs the payments platform team.  " });
    expect(listPeople(d, U)[0].notes).toBe("Runs the payments platform team.");
    upsertPerson(d, U, { name: "Jane Doe", linkedin_url: "in/janedoe", notes: "" });
    expect(listPeople(d, U)[0].notes).toBe("Runs the payments platform team.");
    upsertPerson(d, U, { name: "Jane Doe", linkedin_url: "in/janedoe", company: "Acme" });
    expect(listPeople(d, U)[0]).toMatchObject({ id, company: "Acme", notes: "Runs the payments platform team." });
    upsertPerson(d, U, { name: "Jane Doe", linkedin_url: "in/janedoe", notes: "Moved to the infra org in 2025; posted about on-call last week." });
    expect(listPeople(d, U)[0].notes).toBe("Moved to the infra org in 2025; posted about on-call last week.");
    expect(listPeople(d, U)).toHaveLength(1);
  });

  it("without linkedin_url, always creates a new row (no dedup key)", () => {
    const d = db();
    const id1 = upsertPerson(d, U, { name: "No Link Person" });
    const id2 = upsertPerson(d, U, { name: "No Link Person" });
    expect(id2).not.toBe(id1);
    expect(listPeople(d, U)).toHaveLength(2);
  });

  it("rejects an empty name", () => {
    const d = db();
    expect(() => upsertPerson(d, U, { name: "" })).toThrow();
  });

  it("rejects an invalid relation", () => {
    const d = db();
    expect(() => upsertPerson(d, U, { name: "X", relation: "friend" as never })).toThrow();
  });
});

describe("listPeople", () => {
  it("filters by company and relation", () => {
    const d = db();
    upsertPerson(d, U, { name: "A", company: "Acme", relation: "recruiter" });
    upsertPerson(d, U, { name: "B", company: "Acme", relation: "engineer" });
    upsertPerson(d, U, { name: "C", company: "Globex", relation: "recruiter" });

    expect(listPeople(d, U, { company: "Acme" })).toHaveLength(2);
    expect(listPeople(d, U, { relation: "recruiter" })).toHaveLength(2);
    expect(listPeople(d, U, { company: "Acme", relation: "recruiter" })).toHaveLength(1);
  });
});

describe("createOutreach", () => {
  it("creates an outreach row with status='draft'", () => {
    const d = db();
    const personId = upsertPerson(d, U, { name: "Jane Doe" });
    const outreachId = createOutreach(d, U, {
      personId,
      playbook: "coffee_chat",
      channel: "linkedin",
      draft: "Hi Jane...",
    });
    expect(outreachId).toBeGreaterThan(0);
    const rows = listOutreach(d, U, { personId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "draft", playbook: "coffee_chat", channel: "linkedin" });
  });

  it("rejects an invalid playbook", () => {
    const d = db();
    const personId = upsertPerson(d, U, { name: "Jane Doe" });
    expect(() =>
      createOutreach(d, U, { personId, playbook: "cold_call" as never, channel: "linkedin", draft: "x" })
    ).toThrow();
  });

  it("rejects an invalid channel", () => {
    const d = db();
    const personId = upsertPerson(d, U, { name: "Jane Doe" });
    expect(() =>
      createOutreach(d, U, { personId, playbook: "thanks", channel: "sms" as never, draft: "x" })
    ).toThrow();
  });
});

describe("appendThread", () => {
  it("appends entries in order with ISO timestamps", () => {
    const d = db();
    const personId = upsertPerson(d, U, { name: "Jane Doe" });
    const outreachId = createOutreach(d, U, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });

    appendThread(d, outreachId, { dir: "sent", text: "hi" });
    appendThread(d, outreachId, { dir: "received", text: "sure, when?" });

    const [row] = listOutreach(d, U, { personId });
    expect(row.threadLog).toHaveLength(2);
    expect(row.threadLog[0]).toMatchObject({ dir: "sent", text: "hi" });
    expect(row.threadLog[1]).toMatchObject({ dir: "received", text: "sure, when?" });
    expect(new Date(row.threadLog[0].at).toString()).not.toBe("Invalid Date");
  });

  it("throws on an unknown outreach id", () => {
    const d = db();
    expect(() => appendThread(d, 9999, { dir: "sent", text: "x" })).toThrow();
  });
});

describe("listOutreach", () => {
  it("filters by personId, jobId, and status, ordered by created_at DESC", () => {
    const d = db();
    const p1 = upsertPerson(d, U, { name: "A" });
    const p2 = upsertPerson(d, U, { name: "B" });
    const jobId = d
      .prepare(
        "INSERT INTO jobs (fingerprint, company, title, source, created_at) VALUES (?,?,?,?,?)"
      )
      .run("fp1", "Acme", "SWE", "manual", "2026-01-01 00:00:00").lastInsertRowid as number;

    const o1 = createOutreach(d, U, { personId: p1, jobId, playbook: "referral", channel: "linkedin", draft: "x" });
    const o2 = createOutreach(d, U, { personId: p2, playbook: "coffee_chat", channel: "email", draft: "y" });
    setOutreachStatus(d, o2, "pending_send");

    // Backdate o1 so ordering (DESC) is deterministic regardless of same-second inserts.
    d.prepare("UPDATE outreach SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(o1);

    const byPerson = listOutreach(d, U, { personId: p2 });
    expect(byPerson.map((r) => r.id)).toEqual([o2]);

    const byJob = listOutreach(d, U, { jobId });
    expect(byJob.map((r) => r.id)).toEqual([o1]);

    const byStatus = listOutreach(d, U, { status: "pending_send" });
    expect(byStatus.map((r) => r.id)).toEqual([o2]);

    const all = listOutreach(d, U);
    expect(all.map((r) => r.id)).toEqual([o2, o1]); // DESC by created_at
    expect(all[0]).toMatchObject({ personName: "B" });
  });
});

describe("setOutreachStatus", () => {
  it("updates to a legal status", () => {
    const d = db();
    const personId = upsertPerson(d, U, { name: "Jane Doe" });
    const outreachId = createOutreach(d, U, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
    setOutreachStatus(d, outreachId, "pending_send");
    expect(listOutreach(d, U, { personId })[0].status).toBe("pending_send");
  });

  it("rejects an illegal status", () => {
    const d = db();
    const personId = upsertPerson(d, U, { name: "Jane Doe" });
    const outreachId = createOutreach(d, U, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
    expect(() => setOutreachStatus(d, outreachId, "ghosted")).toThrow();
  });

  it("throws on an unknown outreach id", () => {
    const d = db();
    expect(() => setOutreachStatus(d, 9999, "sent")).toThrow();
  });
});

function seedJob(d: DB, opts: { company?: string; title?: string } = {}): number {
  return d
    .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
    .run(`fp-${Math.random()}`, opts.company ?? "Acme", opts.title ?? "SWE", "manual").lastInsertRowid as number;
}

describe("outreach_jobs", () => {
  it("createOutreach with jobIds links every job and sets job_id to the first", () => {
    const d = db();
    const pid = upsertPerson(d, U, { name: "Jane", company: "Google" });
    const j1 = seedJob(d, { company: "Google", title: "SWE" });
    const j2 = seedJob(d, { company: "Google", title: "SRE" });
    const id = createOutreach(d, U, { personId: pid, playbook: "referral", channel: "linkedin", draft: "hi", jobIds: [j1, j2] });
    expect(outreachJobIds(d, id)).toEqual([j1, j2]);
    expect(listOutreach(d, U, { jobId: j1 })[0].id).toBe(id);
    expect(listOutreach(d, U, { jobId: j2 })[0].id).toBe(id);
    expect(listOutreach(d, U, { jobId: j2 })[0].jobId).toBe(j1);
    expect(outreachForJob(d, U, j2)!.id).toBe(id);
    expect(outreachForJob(d, U, seedJob(d))).toBeNull();
    expect(listOutreach(d, U, { jobLinked: false })).toEqual([]);
    expect(listOutreach(d, U, { jobLinked: true }).map((o) => o.id)).toEqual([id]);
    const coffee = createOutreach(d, U, { personId: pid, playbook: "coffee_chat", channel: "linkedin", draft: "yo" });
    expect(listOutreach(d, U, { jobLinked: false }).map((o) => o.id)).toEqual([coffee]);
  });
});

describe("outreachesForJobs", () => {
  it("returns every outreach covering any of the jobs, newest first, no duplicates", () => {
    const d = db();
    const pid = upsertPerson(d, U, { name: "Jane", company: "Google" });
    const j1 = seedJob(d, { company: "Google", title: "SWE" });
    const j2 = seedJob(d, { company: "Google", title: "SRE" });
    const a = createOutreach(d, U, { personId: pid, playbook: "referral", channel: "linkedin", draft: "a", jobIds: [j1, j2] });
    const b = createOutreach(d, U, { personId: pid, playbook: "referral", channel: "linkedin", draft: "b", jobIds: [j2] });
    createOutreach(d, U, { personId: pid, playbook: "coffee_chat", channel: "linkedin", draft: "c" });
    expect(outreachesForJobs(d, U, [j1, j2]).map((o) => o.id)).toEqual([b, a]);
    expect(outreachesForJobs(d, U, [])).toEqual([]);
  });
});
