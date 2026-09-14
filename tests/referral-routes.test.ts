import { describe, it, expect, vi } from "vitest";
import { openDb, DB } from "@/lib/db";
import { upsertPerson, createOutreach } from "@/network/crm";
import { approveOutreach } from "@/network/gate";
import { takeNextReferral } from "@/apply/referral";
import { approveOutreachAndMaybeAutoStart, reportSentAndMarkReached } from "@/apply/referral-glue";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

function seed(db: DB): number {
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, "Google", "SWE", "https://g", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier, referral_fit) VALUES (?,?,?,?,1)").run(id, "swe_general", 90, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'matched')").run(id);
  return id;
}

describe("referral glue", () => {
  it("approving a job-linked outreach auto-starts a resume run; a coffee-chat one does not", () => {
    const db = openDb(":memory:");
    const a = seed(db);
    takeNextReferral(db, U, {});
    const pid = upsertPerson(db, U, { name: "Jane", company: "Google" });
    const linked = createOutreach(db, U, { personId: pid, playbook: "referral", channel: "linkedin", draft: "x", jobIds: [a] });
    const coffee = createOutreach(db, U, { personId: pid, playbook: "coffee_chat", channel: "linkedin", draft: "y" });
    const startExecutor = vi.fn(() => ({ id: 7, pid: null, logPath: "/tmp/x" }));
    const deps = { hasLiveOrQueuedRun: vi.fn(() => false), lastRunChannel: vi.fn(() => "user_chrome" as const), startExecutor };
    expect(approveOutreachAndMaybeAutoStart(db, U, linked, deps)).toMatchObject({ autoStarted: true, runId: 7 });
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "user_chrome");
    expect(approveOutreachAndMaybeAutoStart(db, U, coffee, deps)).toEqual({ autoStarted: false });
    expect((db.prepare("SELECT status FROM outreach WHERE id = ?").get(coffee) as { status: string }).status).toBe("pending_send");
  });

  it("reportSentAndMarkReached stamps linked jobs", () => {
    const db = openDb(":memory:");
    const a = seed(db);
    takeNextReferral(db, U, {});
    const pid = upsertPerson(db, U, { name: "Jane", company: "Google" });
    const oid = createOutreach(db, U, { personId: pid, playbook: "referral", channel: "linkedin", draft: "x", jobIds: [a] });
    approveOutreach(db, U, oid);
    reportSentAndMarkReached(db, U, oid, "x");
    const row = db.prepare("SELECT referral_reached_at, origin_outreach_id FROM applications WHERE job_id = ?").get(a) as {
      referral_reached_at: string | null;
      origin_outreach_id: number | null;
    };
    expect(row.referral_reached_at).toBeTruthy();
    expect(row.origin_outreach_id).toBe(oid);
  });
});
