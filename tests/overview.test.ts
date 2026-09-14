import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { overview, attentionTotal } from "@/apply/overview";
import { upsertPerson, createOutreach } from "@/network/crm";

function seedJob(
  db: DB,
  status: string,
  extra: Partial<{ confirm_decision: string; needs_manual_reason: string; submitted_at: string }> = {}
) {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, "Acme", "SWE", "manual", "https://acme.example/apply").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "swe_general", 80, 1);
  db.prepare(
    "INSERT INTO applications (job_id, status, confirm_decision, needs_manual_reason, submitted_at) VALUES (?,?,?,?,?)"
  ).run(jobId, status, extra.confirm_decision ?? null, extra.needs_manual_reason ?? null, extra.submitted_at ?? null);
  return jobId;
}

describe("overview", () => {
  it("counts the decision inbox, queue and submissions", () => {
    const db = openDb(":memory:");
    seedJob(db, "matched");
    seedJob(db, "matched");
    seedJob(db, "awaiting_confirm");
    seedJob(db, "awaiting_confirm", { confirm_decision: "approved" });
    seedJob(db, "matched", { needs_manual_reason: "login wall" });
    seedJob(db, "submitted", { submitted_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    const personId = upsertPerson(db, { name: "Pat", company: "Acme", source: "manual" });
    createOutreach(db, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
    const o = overview(db);
    expect(o.counts).toMatchObject({
      awaitingConfirm: 2,
      approvedWaiting: 1,
      needsInfo: 1, // the paused (login wall) row is a 待处理 card now, not a separate 需人工 count
      networkDrafts: 1,
      networkPendingSend: 0,
      queueMatched: 2,
      submittedToday: 1,
      submittedThisWeek: 1,
      referralDrafts: 0,
      referralInFlight: 0,
      referralProgress: 0,
    });
    expect(o.assistant).toBeNull();
    expect(o.liveKinds).toEqual([]);
    expect(o.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // one unapproved confirmation + one paused card are waiting on the user
    expect(attentionTotal(o.counts)).toBe(2);
  });

  it("surfaces the in-flight task before a finished one", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO executor_runs (kind, status, channel, options, started_at, ended_at) VALUES (?,?,?,?,?,?)").run(
      "apply", "done", "user_chrome", "{}", "2026-09-06 10:00:00", "2026-09-06 10:30:00"
    );
    db.prepare("INSERT INTO executor_runs (kind, status, channel, options, started_at) VALUES (?,?,?,?,?)").run(
      "scan", "queued", "user_chrome", "{}", "2026-09-06 11:00:00"
    );
    db.prepare("INSERT INTO executor_runs (kind, status, channel, options, started_at) VALUES (?,?,?,?,?)").run(
      "apply", "running", "user_chrome", "{}", "2026-09-06 11:05:00"
    );
    const o = overview(db);
    expect(o.assistant?.status).toMatch(/queued|running/);
    expect(o.liveKinds.sort()).toEqual(["apply", "scan"]);
  });
});
