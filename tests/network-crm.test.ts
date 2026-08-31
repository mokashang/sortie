import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import {
  upsertPerson,
  listPeople,
  createOutreach,
  appendThread,
  listOutreach,
  setOutreachStatus,
} from "@/network/crm";

function db(): DB {
  return openDb(":memory:");
}

describe("upsertPerson", () => {
  it("creates a new person and returns its id", () => {
    const d = db();
    const id = upsertPerson(d, { name: "Jane Doe", relation: "recruiter" });
    expect(id).toBeGreaterThan(0);
    const people = listPeople(d);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ id, name: "Jane Doe", relation: "recruiter" });
  });

  it("is idempotent on linkedin_url and fills gaps without overwriting existing fields", () => {
    const d = db();
    const id1 = upsertPerson(d, { name: "Jane Doe", linkedin_url: "in/janedoe" });
    // Second call with the same linkedin_url but new company/role info fills the gaps.
    const id2 = upsertPerson(d, {
      name: "Jane Doe",
      linkedin_url: "in/janedoe",
      company: "Acme",
      role_title: "Recruiter",
    });
    expect(id2).toBe(id1);
    let people = listPeople(d);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ company: "Acme", role_title: "Recruiter" });

    // Third call tries to overwrite already-filled company — existing value wins.
    const id3 = upsertPerson(d, {
      name: "Jane Doe",
      linkedin_url: "in/janedoe",
      company: "OtherCo",
    });
    expect(id3).toBe(id1);
    people = listPeople(d);
    expect(people[0].company).toBe("Acme");
  });

  it("without linkedin_url, always creates a new row (no dedup key)", () => {
    const d = db();
    const id1 = upsertPerson(d, { name: "No Link Person" });
    const id2 = upsertPerson(d, { name: "No Link Person" });
    expect(id2).not.toBe(id1);
    expect(listPeople(d)).toHaveLength(2);
  });

  it("rejects an empty name", () => {
    const d = db();
    expect(() => upsertPerson(d, { name: "" })).toThrow();
  });

  it("rejects an invalid relation", () => {
    const d = db();
    expect(() => upsertPerson(d, { name: "X", relation: "friend" as never })).toThrow();
  });
});

describe("listPeople", () => {
  it("filters by company and relation", () => {
    const d = db();
    upsertPerson(d, { name: "A", company: "Acme", relation: "recruiter" });
    upsertPerson(d, { name: "B", company: "Acme", relation: "engineer" });
    upsertPerson(d, { name: "C", company: "Globex", relation: "recruiter" });

    expect(listPeople(d, { company: "Acme" })).toHaveLength(2);
    expect(listPeople(d, { relation: "recruiter" })).toHaveLength(2);
    expect(listPeople(d, { company: "Acme", relation: "recruiter" })).toHaveLength(1);
  });
});

describe("createOutreach", () => {
  it("creates an outreach row with status='draft'", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    const outreachId = createOutreach(d, {
      personId,
      playbook: "coffee_chat",
      channel: "linkedin",
      draft: "Hi Jane...",
    });
    expect(outreachId).toBeGreaterThan(0);
    const rows = listOutreach(d, { personId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "draft", playbook: "coffee_chat", channel: "linkedin" });
  });

  it("rejects an invalid playbook", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    expect(() =>
      createOutreach(d, { personId, playbook: "cold_call" as never, channel: "linkedin", draft: "x" })
    ).toThrow();
  });

  it("rejects an invalid channel", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    expect(() =>
      createOutreach(d, { personId, playbook: "thanks", channel: "sms" as never, draft: "x" })
    ).toThrow();
  });
});

describe("appendThread", () => {
  it("appends entries in order with ISO timestamps", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    const outreachId = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });

    appendThread(d, outreachId, { dir: "sent", text: "hi" });
    appendThread(d, outreachId, { dir: "received", text: "sure, when?" });

    const [row] = listOutreach(d, { personId });
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
    const p1 = upsertPerson(d, { name: "A" });
    const p2 = upsertPerson(d, { name: "B" });
    const jobId = d
      .prepare(
        "INSERT INTO jobs (fingerprint, company, title, source, created_at) VALUES (?,?,?,?,?)"
      )
      .run("fp1", "Acme", "SWE", "manual", "2026-01-01 00:00:00").lastInsertRowid as number;

    const o1 = createOutreach(d, { personId: p1, jobId, playbook: "referral", channel: "linkedin", draft: "x" });
    const o2 = createOutreach(d, { personId: p2, playbook: "coffee_chat", channel: "email", draft: "y" });
    setOutreachStatus(d, o2, "pending_send");

    // Backdate o1 so ordering (DESC) is deterministic regardless of same-second inserts.
    d.prepare("UPDATE outreach SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(o1);

    const byPerson = listOutreach(d, { personId: p2 });
    expect(byPerson.map((r) => r.id)).toEqual([o2]);

    const byJob = listOutreach(d, { jobId });
    expect(byJob.map((r) => r.id)).toEqual([o1]);

    const byStatus = listOutreach(d, { status: "pending_send" });
    expect(byStatus.map((r) => r.id)).toEqual([o2]);

    const all = listOutreach(d);
    expect(all.map((r) => r.id)).toEqual([o2, o1]); // DESC by created_at
    expect(all[0]).toMatchObject({ personName: "B" });
  });
});

describe("setOutreachStatus", () => {
  it("updates to a legal status", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    const outreachId = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
    setOutreachStatus(d, outreachId, "pending_send");
    expect(listOutreach(d, { personId })[0].status).toBe("pending_send");
  });

  it("rejects an illegal status", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    const outreachId = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
    expect(() => setOutreachStatus(d, outreachId, "ghosted")).toThrow();
  });

  it("throws on an unknown outreach id", () => {
    const d = db();
    expect(() => setOutreachStatus(d, 9999, "sent")).toThrow();
  });
});
