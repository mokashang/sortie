import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { upsertPerson, createOutreach, listOutreach } from "@/network/crm";
import {
  approveOutreach,
  rejectOutreach,
  sendables,
  reportSent,
  reportReply,
  updateDraft,
  recordOutcome,
} from "@/network/gate";

function db(): DB {
  return openDb(":memory:");
}

function seedOutreach(
  d: DB,
  opts: { linkedinUrl?: string; draft?: string; jobId?: number } = {}
): { personId: number; outreachId: number } {
  const personId = upsertPerson(d, { name: "Jane Doe", linkedin_url: opts.linkedinUrl ?? "in/janedoe" });
  const outreachId = createOutreach(d, {
    personId,
    jobId: opts.jobId,
    playbook: "coffee_chat",
    channel: "linkedin",
    draft: opts.draft ?? "Hi Jane, would love 15 min!",
  });
  return { personId, outreachId };
}

// Minimal job + applications row, for tests that need recordOutcome's referral_person_id
// linkage to have somewhere real to write.
function seedJobApplication(d: DB): number {
  const jobId = d
    .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
    .run(`fp-${Math.random()}`, "Acme", "SWE", "manual").lastInsertRowid as number;
  d.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'matched')").run(jobId);
  return jobId;
}

describe("approveOutreach", () => {
  it("moves draft -> pending_send", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    expect(listOutreach(d, { personId })[0].status).toBe("pending_send");
  });

  it("throws when not in draft status", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    expect(() => approveOutreach(d, outreachId)).toThrow();
  });

  it("throws for an unknown outreach id", () => {
    const d = db();
    expect(() => approveOutreach(d, 9999)).toThrow();
  });
});

describe("rejectOutreach", () => {
  it("moves draft -> archived with outcome='rejected'", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d);
    rejectOutreach(d, outreachId);
    const row = listOutreach(d, { personId })[0];
    expect(row.status).toBe("archived");
    expect(row.outcome).toBe("rejected");
  });

  it("throws when not in draft status", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    expect(() => rejectOutreach(d, outreachId)).toThrow();
  });

  it("a rejected (archived) outreach can never be reportSent — it's a dead end, not just 'not yet approved'", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    rejectOutreach(d, outreachId);
    expect(() => reportSent(d, outreachId)).toThrow();
  });
});

describe("updateDraft", () => {
  it("updates the draft text while status is still draft", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d);
    updateDraft(d, outreachId, "Edited message");
    expect(listOutreach(d, { personId })[0].draft).toBe("Edited message");
  });

  it("throws once the outreach has moved past draft", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    expect(() => updateDraft(d, outreachId, "too late")).toThrow();
  });
});

describe("sendables", () => {
  it("lists only pending_send outreach, joined with person info", () => {
    const d = db();
    const { outreachId: draftId } = seedOutreach(d, { linkedinUrl: "in/still-draft" });
    const { outreachId: pendingId } = seedOutreach(d, { linkedinUrl: "in/ready", draft: "ready to send" });
    approveOutreach(d, pendingId);
    void draftId;

    const rows = sendables(d);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: pendingId, draft: "ready to send", linkedinUrl: "in/ready", personName: "Jane Doe" });
  });
});

describe("reportSent — RED LINE", () => {
  it("throws when called directly on a draft-status outreach (no approval)", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    expect(() => reportSent(d, outreachId)).toThrow();
  });

  it("succeeds after approve, moving status to 'sent' and appending a thread_log entry", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d, { draft: "Hi Jane, would love 15 min!" });
    approveOutreach(d, outreachId);

    reportSent(d, outreachId);

    const row = listOutreach(d, { personId })[0];
    expect(row.status).toBe("sent");
    expect(row.threadLog).toHaveLength(1);
    expect(row.threadLog[0]).toMatchObject({ dir: "sent", text: "Hi Jane, would love 15 min!" });
  });

  it("throws on a second reportSent (already sent)", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    reportSent(d, outreachId);
    expect(() => reportSent(d, outreachId)).toThrow();
  });

  it("throws for an unknown outreach id", () => {
    const d = db();
    expect(() => reportSent(d, 9999)).toThrow();
  });

  it("with sentText: records the actual sent text (e.g. a trimmed connection note) in thread_log, not the full draft", () => {
    const d = db();
    const fullDraft = "Hi Jane, I'd love to learn about your team and how you got into the role — would you have 15 minutes to chat sometime this week or next?";
    const { outreachId, personId } = seedOutreach(d, { draft: fullDraft });
    approveOutreach(d, outreachId);

    const trimmed = "Hi Jane, would love 15 min to learn about your team!";
    reportSent(d, outreachId, trimmed);

    const row = listOutreach(d, { personId })[0];
    expect(row.status).toBe("sent");
    expect(row.threadLog[0].text).toBe(trimmed);
    expect(row.draft).toBe(fullDraft); // draft column itself is untouched
  });

  it("without sentText: falls back to the draft column, as before", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d, { draft: "the full DM" });
    approveOutreach(d, outreachId);

    reportSent(d, outreachId);

    const row = listOutreach(d, { personId })[0];
    expect(row.threadLog[0].text).toBe("the full DM");
  });
});

describe("recordOutcome", () => {
  it("records 'meeting' from status='sent'", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    reportSent(d, outreachId);

    recordOutcome(d, outreachId, "meeting");

    expect(listOutreach(d, { personId })[0].status).toBe("meeting");
  });

  it("records 'no_response' from status='replied'", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    reportSent(d, outreachId);
    reportReply(d, outreachId, "not interested, sorry");

    recordOutcome(d, outreachId, "no_response");

    expect(listOutreach(d, { personId })[0].status).toBe("no_response");
  });

  it("throws when outreach is not sent or replied (e.g. still pending_send)", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    expect(() => recordOutcome(d, outreachId, "meeting")).toThrow();
  });

  it("throws on an invalid outcome value", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    reportSent(d, outreachId);
    expect(() => recordOutcome(d, outreachId, "won_the_lottery" as unknown as "meeting")).toThrow();
  });

  it("throws for an unknown outreach id", () => {
    const d = db();
    expect(() => recordOutcome(d, 9999, "meeting")).toThrow();
  });

  it("'referral_won' with a job_id also stamps applications.referral_person_id for that job", () => {
    const d = db();
    const jobId = seedJobApplication(d);
    const { outreachId, personId } = seedOutreach(d, { jobId });
    approveOutreach(d, outreachId);
    reportSent(d, outreachId);

    recordOutcome(d, outreachId, "referral_won");

    expect(listOutreach(d, { personId })[0].status).toBe("referral_won");
    const app = d.prepare("SELECT referral_person_id FROM applications WHERE job_id = ?").get(jobId) as {
      referral_person_id: number | null;
    };
    expect(app.referral_person_id).toBe(personId);
  });

  it("'referral_won' with no job_id doesn't touch applications (nothing to link)", () => {
    const d = db();
    const { outreachId } = seedOutreach(d); // no jobId
    approveOutreach(d, outreachId);
    reportSent(d, outreachId);
    expect(() => recordOutcome(d, outreachId, "referral_won")).not.toThrow();
  });
});

describe("reportReply", () => {
  it("moves sent -> replied and appends a received thread_log entry", () => {
    const d = db();
    const { outreachId, personId } = seedOutreach(d);
    approveOutreach(d, outreachId);
    reportSent(d, outreachId);

    reportReply(d, outreachId, "Sure, how about Tuesday?");

    const row = listOutreach(d, { personId })[0];
    expect(row.status).toBe("replied");
    expect(row.threadLog).toHaveLength(2);
    expect(row.threadLog[1]).toMatchObject({ dir: "received", text: "Sure, how about Tuesday?" });
  });

  it("throws when the outreach was never sent", () => {
    const d = db();
    const { outreachId } = seedOutreach(d);
    expect(() => reportReply(d, outreachId, "hi")).toThrow();
  });
});
