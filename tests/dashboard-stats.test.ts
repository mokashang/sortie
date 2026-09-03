import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { upsertPerson, createOutreach } from "@/network/crm";
import { funnel, byDirection, networkingFunnel, crossStats, weekly, todo } from "@/network/stats";

function db(): DB {
  return openDb(":memory:");
}

// Inserts one job + matches row + applications row, with full control over the fields the
// dashboard stats functions read (status/direction/tier/submitted_at/referral_person_id).
function seedApp(
  d: DB,
  opts: {
    company?: string;
    direction?: string | null;
    tier?: number | null;
    status?: string;
    submittedAt?: string | null;
    referralPersonId?: number | null;
    noMatch?: boolean;
  } = {}
): number {
  const jobId = d
    .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
    .run(`fp-${Math.random()}`, opts.company ?? "Acme", "SWE", "manual").lastInsertRowid as number;

  if (!opts.noMatch) {
    d.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(
      jobId,
      opts.direction === undefined ? "swe_general" : opts.direction,
      80,
      opts.tier === undefined ? 1 : opts.tier
    );
  }

  d.prepare(
    "INSERT INTO applications (job_id, status, submitted_at, referral_person_id) VALUES (?,?,?,?)"
  ).run(jobId, opts.status ?? "discovered", opts.submittedAt ?? null, opts.referralPersonId ?? null);

  return jobId;
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

describe("funnel", () => {
  it("counts applications by status, ignoring statuses outside the named funnel stages", () => {
    const d = db();
    seedApp(d, { status: "discovered" });
    seedApp(d, { status: "matched" });
    seedApp(d, { status: "submitted", submittedAt: daysAgo(0) });
    seedApp(d, { status: "oa", submittedAt: daysAgo(0) });
    seedApp(d, { status: "interview", submittedAt: daysAgo(3) });
    seedApp(d, { status: "offer", submittedAt: daysAgo(10) });
    seedApp(d, { status: "rejected", submittedAt: daysAgo(20) });
    seedApp(d, { status: "archived" });
    // Not part of the named funnel stages — must not be silently folded into any bucket.
    seedApp(d, { status: "prepared" });
    seedApp(d, { status: "awaiting_confirm" });
    // accepted / declined offers fold into the offer bucket — an offer is an offer
    seedApp(d, { status: "offer_accepted", submittedAt: daysAgo(30) });
    seedApp(d, { status: "offer_declined", submittedAt: daysAgo(30) });

    expect(funnel(d)).toEqual({
      discovered: 1,
      matched: 1,
      submitted: 1,
      oa: 1,
      interview: 1,
      offer: 3,
      rejected: 1,
      archived: 1,
    });
  });

  it("returns all zeros on an empty db", () => {
    const d = db();
    expect(funnel(d)).toEqual({
      discovered: 0,
      matched: 0,
      submitted: 0,
      oa: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      archived: 0,
    });
  });
});

describe("byDirection", () => {
  it("groups matches by direction+tier and counts total/submitted/interviews", () => {
    const d = db();
    // swe_general / tier 1: 4 matched jobs total (discovered/matched/submitted/interview),
    // 2 of which were ever submitted (submitted_at set), 1 reached interview-or-beyond.
    seedApp(d, { direction: "swe_general", tier: 1, status: "discovered" });
    seedApp(d, { direction: "swe_general", tier: 1, status: "matched" });
    seedApp(d, { direction: "swe_general", tier: 1, status: "submitted", submittedAt: daysAgo(0) });
    seedApp(d, { direction: "swe_general", tier: 1, status: "interview", submittedAt: daysAgo(3) });

    // ai_infra / tier 2: 3 total, all 3 ever submitted, 1 reached offer (counts as interviews-or-beyond).
    seedApp(d, { direction: "ai_infra", tier: 2, status: "oa", submittedAt: daysAgo(0) });
    seedApp(d, { direction: "ai_infra", tier: 2, status: "offer", submittedAt: daysAgo(10) });
    seedApp(d, { direction: "ai_infra", tier: 2, status: "rejected", submittedAt: daysAgo(20) });
    // an accepted / declined offer is still an interview-or-beyond
    seedApp(d, { direction: "ai_infra", tier: 2, status: "offer_accepted", submittedAt: daysAgo(30) });
    seedApp(d, { direction: "ai_infra", tier: 2, status: "offer_declined", submittedAt: daysAgo(30) });

    const rows = byDirection(d);
    const swe = rows.find((r) => r.direction === "swe_general" && r.tier === 1);
    const ai = rows.find((r) => r.direction === "ai_infra" && r.tier === 2);

    expect(swe).toEqual({ direction: "swe_general", tier: 1, total: 4, submitted: 2, interviews: 1 });
    expect(ai).toEqual({ direction: "ai_infra", tier: 2, total: 5, submitted: 5, interviews: 3 });
  });

  it("returns an empty array on an empty db", () => {
    const d = db();
    expect(byDirection(d)).toEqual([]);
  });

  it("sorts the NULL-direction bucket last, even when its tier would otherwise sort it first", () => {
    const d = db();
    // tier 1 with no direction (e.g. a match the scorer couldn't confidently bucket) — a plain
    // "ORDER BY tier ASC" would put this ahead of every named-direction row.
    seedApp(d, { direction: null, tier: 1, status: "matched" });
    seedApp(d, { direction: "swe_general", tier: 3, status: "matched" });

    const rows = byDirection(d);
    expect(rows).toHaveLength(2);
    expect(rows[rows.length - 1].direction).toBeNull();
    expect(rows[0].direction).toBe("swe_general");
  });
});

describe("networkingFunnel", () => {
  it("counts outreach by status for the named networking stages", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    const statuses = ["draft", "draft", "pending_send", "sent", "replied", "meeting", "referral_won", "no_response", "archived"];
    for (const status of statuses) {
      const id = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
      d.prepare("UPDATE outreach SET status = ? WHERE id = ?").run(status, id);
    }

    expect(networkingFunnel(d)).toEqual({
      drafts: 2,
      pending: 1,
      sent: 1,
      replied: 1,
      meetings: 1,
      referrals: 1,
    });
  });

  it("returns all zeros on an empty db", () => {
    const d = db();
    expect(networkingFunnel(d)).toEqual({ drafts: 0, pending: 0, sent: 0, replied: 0, meetings: 0, referrals: 0 });
  });
});

describe("crossStats", () => {
  it("splits submitted/interviews by whether the application has a referral_person_id", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Referrer" });

    // With referral: 2 apps, both submitted, both interview-or-beyond.
    seedApp(d, { status: "interview", submittedAt: daysAgo(3), referralPersonId: personId });
    seedApp(d, { status: "offer", submittedAt: daysAgo(10), referralPersonId: personId });

    // Without referral: 3 apps, 2 submitted (1 not), 0 interview-or-beyond.
    seedApp(d, { status: "submitted", submittedAt: daysAgo(0) });
    seedApp(d, { status: "oa", submittedAt: daysAgo(1) });
    seedApp(d, { status: "matched" }); // never submitted

    expect(crossStats(d)).toEqual({
      withReferral: { submitted: 2, interviews: 2 },
      without: { submitted: 2, interviews: 0 },
    });
  });
});

describe("weekly", () => {
  it("buckets applications.submitted_at and outreach.created_at into this-week / last-week (rolling 7-day windows)", () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });

    // Applications: 3 submitted this week (0/3/6 days ago), 1 last week (10 days ago),
    // 1 too old for either bucket (20 days ago).
    seedApp(d, { status: "submitted", submittedAt: daysAgo(0) });
    seedApp(d, { status: "interview", submittedAt: daysAgo(3) });
    seedApp(d, { status: "oa", submittedAt: daysAgo(6) });
    seedApp(d, { status: "offer", submittedAt: daysAgo(10) });
    seedApp(d, { status: "rejected", submittedAt: daysAgo(20) });

    // Outreach: 2 created this week, 1 created last week.
    for (const [i, offset] of [0, 5, 9].entries()) {
      const id = createOutreach(d, {
        personId,
        playbook: "coffee_chat",
        channel: "linkedin",
        draft: `msg ${i}`,
      });
      d.prepare("UPDATE outreach SET created_at = ? WHERE id = ?").run(daysAgo(offset), id);
    }

    expect(weekly(d)).toEqual({
      thisWeek: { submittedApplications: 3, newOutreach: 2 },
      lastWeek: { submittedApplications: 1, newOutreach: 1 },
    });
  });
});

describe("todo", () => {
  it("counts pendingConfirms/pendingSends and lists stale (>5 days, no reply) followups", () => {
    const d = db();
    seedApp(d, { status: "awaiting_confirm" });
    seedApp(d, { status: "awaiting_confirm" });
    seedApp(d, { status: "matched" });

    const personId = upsertPerson(d, { name: "Stale Contact", company: "Acme" });
    upsertPerson(d, { name: "Recent Contact", company: "Acme" });

    // Two drafts awaiting the user's approve/reject decision.
    createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "d1" });
    createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "d2" });

    // Stale: sent 10 days ago, never replied.
    const staleId = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "stale" });
    d.prepare("UPDATE outreach SET status = 'sent' WHERE id = ?").run(staleId);
    d.prepare("UPDATE outreach SET thread_log = ? WHERE id = ?").run(
      JSON.stringify([{ at: daysAgo(10), dir: "sent", text: "stale" }]),
      staleId
    );

    // Not stale: sent 1 day ago.
    const recentId = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "recent" });
    d.prepare("UPDATE outreach SET status = 'sent' WHERE id = ?").run(recentId);
    d.prepare("UPDATE outreach SET thread_log = ? WHERE id = ?").run(
      JSON.stringify([{ at: daysAgo(1), dir: "sent", text: "recent" }]),
      recentId
    );

    // Not stale (excluded): replied, even though the original send was long ago.
    const repliedId = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "replied" });
    d.prepare("UPDATE outreach SET status = 'replied' WHERE id = ?").run(repliedId);
    d.prepare("UPDATE outreach SET thread_log = ? WHERE id = ?").run(
      JSON.stringify([
        { at: daysAgo(10), dir: "sent", text: "replied" },
        { at: daysAgo(9), dir: "received", text: "reply" },
      ]),
      repliedId
    );

    const result = todo(d);
    expect(result.pendingConfirms).toBe(2);
    expect(result.pendingSends).toBe(2);
    expect(result.staleFollowups).toHaveLength(1);
    expect(result.staleFollowups[0].outreachId).toBe(staleId);
    expect(result.staleFollowups[0].personName).toBe("Stale Contact");
    expect(result.staleFollowups[0].daysSince).toBeGreaterThanOrEqual(5);
  });
});
