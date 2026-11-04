import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { applicationRecords, recordsBlock, unsupportedClaims, ApplicationRecords } from "@/network/claims";

const U = "legacy";

const none: ApplicationRecords = {
  submitted: [],
  notSubmitted: [
    { company: "Acme", title: "Software Engineer, Agent Infrastructure" },
    { company: "Acme", title: "Training Performance Engineer" },
  ],
};
const otherRole: ApplicationRecords = {
  submitted: [{ company: "Acme", title: "Research Engineer, Retrieval", status: "submitted" }],
  notSubmitted: none.notSubmitted,
};

describe("unsupportedClaims", () => {
  // The wording of the messages that went out in 2026-10 and 2026-11 with nothing on record.
  it.each([
    "Small update: I went ahead and applied to all three roles.",
    "Small update on my end — I've gone ahead and applied to both roles.",
    "I already applied to a few of the SWE roles, so I really appreciate the tips.",
    "Ah, I actually did submit it already (through the referral flow after we last talked) - sorry for the mixup!",
    "One update: I went ahead and applied directly to the role too, so it's officially in the system now.",
    "I'm especially curious about the team's work since that's the role I applied to.",
    "Applied to the AI-Native PDE role — would love to connect!",
    "I just applied to the Product Engineer role.",
  ])("flags a claimed application with nothing submitted: %s", (text) => {
    expect(unsupportedClaims(text, none)).toEqual([text]);
  });

  it("flags a hiring process that hasn't moved, whatever was submitted", () => {
    const text = "I've since heard back from Acme and am moving forward in the process, which was great news.";
    expect(unsupportedClaims(text, otherRole)).toEqual([text]);
    expect(unsupportedClaims("I have an interview there next week.", otherRole)).toHaveLength(1);
  });

  it("lets a process claim through when an application really moved", () => {
    const moved = { ...otherRole, submitted: [{ ...otherRole.submitted[0], status: "interview" }] };
    expect(unsupportedClaims("I've since heard back and have an interview next week.", moved)).toEqual([]);
  });

  it("a role that went in may be claimed by name; a vague or wrong claim may not", () => {
    expect(unsupportedClaims("I've applied to the Research Engineer, Retrieval role.", otherRole)).toEqual([]);
    expect(unsupportedClaims("I went ahead and applied to all three roles.", otherRole)).toHaveLength(1);
    expect(unsupportedClaims("I've applied to the Agent Infrastructure role.", otherRole)).toHaveLength(1);
    expect(unsupportedClaims("I've applied to the Retrieval and Training Performance roles.", otherRole)).toHaveLength(1);
  });

  it("with everything in, a general claim is true", () => {
    const all: ApplicationRecords = { submitted: otherRole.submitted, notSubmitted: [] };
    expect(unsupportedClaims("I've applied to both, thanks again!", all)).toEqual([]);
  });

  it.each([
    "I'm applying to the Agent Infrastructure role either way.",
    "I'll apply this week and let you know once it's in.",
    "I'll let you know once I've applied.",
    "I haven't applied yet, so a referral would be perfect timing.",
    "I have not applied yet.",
    "If my application is in by Friday, would that still work?",
    "I applied ReAct-style planning to a Playwright loop.",
    "I've submitted a few PRs to SQLFluff.",
    "No worries if you haven't heard back from the team.",
    "Would you be open to a referral or a pointer to whoever owns hiring?",
  ])("leaves ordinary wording alone: %s", (text) => {
    expect(unsupportedClaims(text, none)).toEqual([]);
  });
});

describe("applicationRecords", () => {
  function seed(db: DB, company: string, title: string, submittedAt: string | null, status = "matched"): number {
    const id = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
      .run(`fp-${Math.random()}`, company, title, "https://x/1", "manual").lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status, submitted_at) VALUES (?,?,?)").run(id, status, submittedAt);
    return id;
  }

  it("splits this conversation's roles by what went in, and adds other roles at the company", () => {
    const db = openDb(":memory:");
    const linked = seed(db, "Acme", "Backend Engineer", null, "referral_seeking");
    const done = seed(db, "Acme", "Frontend Engineer", "2026-10-01 10:00:00", "submitted");
    seed(db, "ACME", "Research Engineer", "2026-10-02 10:00:00", "interview");
    seed(db, "Globex", "Data Engineer", "2026-10-03 10:00:00", "submitted");
    const r = applicationRecords(db, U, [linked, done]);
    expect(r.notSubmitted).toEqual([{ company: "Acme", title: "Backend Engineer" }]);
    expect(r.submitted.map((s) => `${s.title}/${s.status}`)).toEqual(["Frontend Engineer/submitted", "Research Engineer/interview"]);
  });

  it("a role deduped into a submitted posting of the same title counts as in", () => {
    const db = openDb(":memory:");
    const twin = seed(db, "Acme", "Backend Engineer", null, "archived");
    seed(db, "Acme", "backend engineer", "2026-10-01 10:00:00", "submitted");
    expect(applicationRecords(db, U, [twin]).notSubmitted).toEqual([]);
  });

  it("another account's submission is not evidence", () => {
    const db = openDb(":memory:");
    const id = seed(db, "Acme", "Backend Engineer", "2026-10-01 10:00:00", "submitted");
    const r = applicationRecords(db, "someone-else", [id]);
    expect(r.submitted).toEqual([]);
    expect(r.notSubmitted).toHaveLength(1);
  });

  it("no jobs, no records; the prompt block says so outright", () => {
    const db = openDb(":memory:");
    const r = applicationRecords(db, U, []);
    expect(r).toEqual({ submitted: [], notSubmitted: [] });
    expect(recordsBlock(r)).toMatch(/Submitted: none/);
    expect(recordsBlock(otherRole)).toMatch(/Acme: Research Engineer, Retrieval \(status: submitted\)/);
    expect(recordsBlock(otherRole)).toMatch(/Not submitted yet:\n- Acme: Software Engineer, Agent Infrastructure/);
  });
});
