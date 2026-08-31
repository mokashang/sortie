import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { upsertPerson, createOutreach, listOutreach } from "@/network/crm";
import { approveOutreach, rejectOutreach, sendables, reportSent, reportReply, updateDraft } from "@/network/gate";

function db(): DB {
  return openDb(":memory:");
}

function seedOutreach(d: DB, opts: { linkedinUrl?: string; draft?: string } = {}): { personId: number; outreachId: number } {
  const personId = upsertPerson(d, { name: "Jane Doe", linkedin_url: opts.linkedinUrl ?? "in/janedoe" });
  const outreachId = createOutreach(d, {
    personId,
    playbook: "coffee_chat",
    channel: "linkedin",
    draft: opts.draft ?? "Hi Jane, would love 15 min!",
  });
  return { personId, outreachId };
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
