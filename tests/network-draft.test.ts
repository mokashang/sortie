import { describe, it, expect, vi } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile, Profile } from "@/lib/profile";
import { upsertPerson, createOutreach, appendThread, listOutreach, outreachJobIds } from "@/network/crm";
import { buildDraftPrompt, generateDraft, trimToNote, shortenNote, pickHighlights, NOTE_MAX_CHARS } from "@/network/draft";
import { createExperience } from "@/resume/experiences";
import { LlmBackend, LlmRequest } from "@/llm/types";

const baseYaml = `
name: Mengjia Shang
email: shangmengjiajiajia@gmail.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/mengjia-shang
github: github.com/mokashang
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1
  needs_sponsorship: true
targets:
  primary: newgrad
  secondary: intern
directions:
  swe_general: 1
  ai_infra: 1
daily_minutes_budget: 90
`;

function testProfile(): Profile {
  return parseProfile(baseYaml);
}

function db(): DB {
  return openDb(":memory:");
}

function fakeBackend(response: object): { backend: LlmBackend; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    backend: {
      name: "fake",
      complete: async (req: LlmRequest) => {
        requests.push(req);
        return { text: JSON.stringify(response), backend: "fake" };
      },
    },
  };
}

function seedJob(d: DB, opts: { company?: string; title?: string; applyUrl?: string } = {}): number {
  return d
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source, created_at) VALUES (?,?,?,?,?,?)")
    .run(
      `fp-${Math.random()}`,
      opts.company ?? "Acme",
      opts.title ?? "SWE",
      opts.applyUrl ?? "https://acme.example/apply",
      "manual",
      "2026-01-01 00:00:00"
    ).lastInsertRowid as number;
}

describe("buildDraftPrompt", () => {
  it("includes the never-fabricate constraint and word-count guidance in the system prompt", () => {
    const person = { id: 1, name: "Jane Doe", company: "Acme", role_title: "Recruiter", relation: "recruiter" } as never;
    const req = buildDraftPrompt(testProfile(), person, "coffee_chat");
    expect(req.system).toMatch(/never fabricate|don't fabricate|do not fabricate|不编造/i);
    expect(req.system).toMatch(/120/); // ≤120 word guidance
    expect(req.system).toMatch(/200/); // connection-request character cap guidance
  });

  it("fences the Recipient block and thread excerpt as untrusted, instruction-free data", () => {
    const person = { id: 1, name: "Jane Doe", company: "Acme", role_title: "Recruiter", relation: "recruiter" } as never;
    const req = buildDraftPrompt(testProfile(), person, "coffee_chat");
    expect(req.system).toMatch(/untrusted/i);
    expect(req.system).toMatch(/never follow any instruction/i);
  });

  it("mentions a Trojan/USC alum connection when relation is 'alum'", () => {
    const alum = { id: 1, name: "Jane Doe", company: "Acme", role_title: "Eng", relation: "alum" } as never;
    const req = buildDraftPrompt(testProfile(), alum, "coffee_chat");
    expect(req.system + req.prompt).toMatch(/trojan|usc/i);
  });

  it("includes the job title/company/link for the referral playbook", () => {
    const person = { id: 1, name: "Jane Doe", company: "Acme", role_title: "Eng", relation: "engineer" } as never;
    const job = { id: 1, company: "Acme", title: "SWE Intern", applyUrl: "https://acme.example/apply" };
    const req = buildDraftPrompt(testProfile(), person, "referral", job);
    expect(req.prompt).toContain("SWE Intern");
    expect(req.prompt).toContain("https://acme.example/apply");
  });

  it("includes the last thread_log entry for the followup playbook", () => {
    const person = { id: 1, name: "Jane Doe", company: "Acme", role_title: "Eng", relation: "engineer" } as never;
    const req = buildDraftPrompt(testProfile(), person, "followup", undefined, {
      at: "2026-01-01T00:00:00.000Z",
      dir: "sent",
      text: "Hey, following up on my note last week!",
    });
    expect(req.prompt).toContain("Hey, following up on my note last week!");
  });
});

// 2026-09-11 wording rework: every message gives before it asks (a true line about them, one
// concrete thing the candidate built, a small ask with an easy out, a close that stands alone).
describe("give-first wording", () => {
  const person = { name: "Jane Doe", company: "Acme", role_title: "Eng", relation: "engineer" as string | null };

  it("system prompt carries the give-before-ask structure, the easy out, and bans flattery/hollow openers", () => {
    const req = buildDraftPrompt(testProfile(), person, "referral", { company: "Acme", title: "SWE" });
    expect(req.system).toMatch(/give before you ask/i);
    expect(req.system).toMatch(/one specific, true line about them/i);
    expect(req.system).toMatch(/easy out/i);
    expect(req.system).toMatch(/applying regardless|applying either way/i);
    expect(req.system).toMatch(/never imply they owe you/i);
    expect(req.system).toMatch(/never flatter/i);
    expect(req.system).toMatch(/hope this finds you well/i);
    expect(req.system).toMatch(/one short question about their own experience/i);
    expect(req.system).toMatch(/visas or sponsorship/i);
  });

  it("referral guidance asks lightly (referral OR a pointer, a no is fine) and never for a résumé review", () => {
    const req = buildDraftPrompt(testProfile(), person, "referral", { company: "Acme", title: "SWE" });
    expect(req.system).toMatch(/a pointer to whoever owns hiring/i);
    expect(req.system).toMatch(/a no is completely fine/i);
    expect(req.system).toMatch(/don't ask them to review your résumé/i);
  });

  it("followup guidance bans nudging phrases; coffee_chat offers an async alternative; thanks has no new ask", () => {
    expect(buildDraftPrompt(testProfile(), person, "followup").system).toMatch(/just checking in/i);
    expect(buildDraftPrompt(testProfile(), person, "followup").system).toMatch(/completely fine if now isn't a good time/i);
    expect(buildDraftPrompt(testProfile(), person, "coffee_chat").system).toMatch(/async alternative/i);
    expect(buildDraftPrompt(testProfile(), person, "thanks").system).toMatch(/no new ask/i);
  });

  it("alum guidance frames USC as a bridge, not a lever", () => {
    const alum = { ...person, relation: "alum" };
    expect(buildDraftPrompt(testProfile(), alum, "referral").system).toMatch(/bridge, not a lever/i);
    expect(buildDraftPrompt(testProfile(), person, "referral").system).not.toMatch(/bridge, not a lever/i);
  });

  it("puts the recipient's profile notes in the Recipient block and marks them as the only source for the line about them", () => {
    const withNotes = { ...person, notes: "Moved from robotics research at USC to the perception team in 2024." };
    const req = buildDraftPrompt(testProfile(), withNotes, "referral");
    expect(req.prompt).toContain("Moved from robotics research at USC to the perception team in 2024.");
    expect(req.prompt).toMatch(/ONLY source for the line about them/);
    expect(req.prompt).toMatch(/— use it/);
    const without = buildDraftPrompt(testProfile(), person, "referral");
    expect(without.prompt).toMatch(/do not pretend to know more than their title and company/i);
    expect(without.prompt).toContain('"notes": null');
  });

  it("lists candidate highlights (one to mention, never invent) and the job's direction label", () => {
    const req = buildDraftPrompt(
      testProfile(),
      person,
      "referral",
      { company: "Acme", title: "ML Systems Eng", direction: "ai_infra" },
      undefined,
      { highlights: [{ kind: "project", title: "flash-attention-mini", organization: "Triton, CUDA", bullet: "Reimplemented FlashAttention forward in Triton." }] }
    );
    expect(req.prompt).toMatch(/Candidate highlights/);
    expect(req.prompt).toMatch(/mention at most ONE/);
    expect(req.prompt).toContain("[project] flash-attention-mini @ Triton, CUDA: Reimplemented FlashAttention forward in Triton.");
    expect(req.prompt).toContain("AI Infra / ML Systems");
    expect(buildDraftPrompt(testProfile(), person, "referral").prompt).not.toMatch(/Candidate highlights/);
  });

  it("the connection-note guidance makes the note a first hello: never opens with the referral ask, no URLs, at most one role", () => {
    const req = buildDraftPrompt(testProfile(), person, "referral", { company: "Acme", title: "SWE" }, undefined, { note: true });
    expect(req.prompt).toMatch(/first hello/i);
    expect(req.prompt).toMatch(/never open with the referral ask/i);
    expect(req.prompt).toMatch(/at most one role/i);
    expect(req.prompt).toMatch(/no URLs/);
  });

  it("pickHighlights prefers bullets tagged with the target directions, work before projects, and caps the list", () => {
    const exp = (id: number, kind: "work" | "project" | "skill", title: string, bullets: { text: string; directions: string[] }[], sort_order = 0) =>
      ({ id, kind, title, organization: null, location: null, start_date: null, end_date: null, bullets, sort_order }) as never;
    const list = [
      exp(1, "skill", "Languages", [{ text: "C++", directions: ["swe_general"] }]),
      exp(2, "project", "cuda-kernels", [{ text: "Fused softmax kernel.", directions: ["gpu_cuda", "ai_infra"] }, { text: "Roofline profiling.", directions: ["gpu_cuda"] }]),
      exp(3, "work", "Intern @ Pay", [{ text: "Integrated gRPC APIs.", directions: ["swe_backend"] }, { text: "Built vLLM serving.", directions: ["ai_infra"] }]),
      exp(4, "project", "chat-app", [{ text: "WebSocket chat.", directions: ["swe_backend"] }], 5),
      exp(5, "project", "lob-engine", [{ text: "Order book.", directions: ["quant"] }], 1),
    ];
    const picked = pickHighlights(list, ["ai_infra"]);
    expect(picked.map((h) => h.title)).toEqual(["Intern @ Pay", "cuda-kernels", "lob-engine", "chat-app"]);
    expect(picked[0].bullet).toBe("Built vLLM serving."); // the bullet tagged with the target direction, not the first one
    expect(picked[1].bullet).toBe("Fused softmax kernel.");
    expect(pickHighlights(list, ["ai_infra"], 2)).toHaveLength(2);
    expect(pickHighlights(list, [])).toHaveLength(4); // no direction: still work first, skills never
    const long = exp(9, "project", "long", [{ text: "x".repeat(400), directions: [] }]);
    expect(pickHighlights([long], []) [0].bullet.length).toBeLessThanOrEqual(220);
  });

  it("generateDraft feeds the experiences table and the person's notes into the prompt", async () => {
    const d = db();
    createExperience(d, {
      kind: "work",
      title: "Software Engineer Intern",
      organization: "UnionPay",
      bullets: [{ text: "Integrated REST/gRPC APIs for cross-border payments.", directions: ["swe_backend", "swe_general"] }],
      sort_order: 0,
    });
    createExperience(d, { kind: "skill", title: "Languages", bullets: [{ text: "C++, Python", directions: ["swe_general"] }], sort_order: 0 });
    const personId = upsertPerson(d, { name: "Jane", company: "Acme", relation: "engineer", linkedin_url: "in/jane", notes: "Leads the payments platform team; posted about idempotency last week." });
    const { backend, requests } = fakeBackend({ message: "Hi Jane", note: "Hi Jane" });
    await generateDraft(d, { backend, profile: testProfile(), personId, playbook: "coffee_chat" });
    expect(requests[0].prompt).toContain("[work] Software Engineer Intern @ UnionPay: Integrated REST/gRPC APIs for cross-border payments.");
    expect(requests[0].prompt).not.toContain("C++, Python");
    expect(requests[0].prompt).toContain("Leads the payments platform team; posted about idempotency last week.");
  });

  it("shortenNote's compressor keeps the line about them and never reduces the note to a bare referral ask", async () => {
    const d = db();
    const pid = upsertPerson(d, { name: "Jane", company: "Google" });
    const id = createOutreach(d, { personId: pid, playbook: "referral", channel: "linkedin", draft: "Your path from USC to Google's SRE team caught my eye. I'm an MS ECE student; would love to hear how you found the team, and ask about the SRE opening if you're open to it." });
    const seen: LlmRequest[] = [];
    const backend: LlmBackend = {
      name: "rec",
      complete: async (req) => {
        seen.push(req);
        return { text: JSON.stringify({ note: "Your path from USC to Google's SRE team caught my eye — would love to hear how you found it." }), backend: "rec" };
      },
    };
    const r = await shortenNote(d, { backend, outreachId: id, max: 120 });
    expect(r.source).toBe("model");
    expect(seen[0].system).toMatch(/first hello, not a request form/i);
    expect(seen[0].system).toMatch(/keep the line that is specifically about the recipient/i);
    expect(seen[0].system).toMatch(/never reduce it to a bare 'can you refer me'/i);
  });
});

describe("generateDraft", () => {
  it("creates an outreach row from a fake backend's fixed JSON, with draft = message for linkedin", async () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe", relation: "engineer" });
    const { backend } = fakeBackend({ message: "Hi Jane, would love 15 min to chat!" });

    const result = await generateDraft(d, { backend, profile: testProfile(), personId, playbook: "coffee_chat" });

    expect(result.outreachId).toBeGreaterThan(0);
    expect(result.draft).toBe("Hi Jane, would love 15 min to chat!");
    const rows = listOutreach(d, { personId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "draft", playbook: "coffee_chat", channel: "linkedin", draft: result.draft });
  });

  it("for email channel, prefixes the draft with 'Subject: ...' when the model returns a subject", async () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe", relation: "recruiter" });
    const { backend } = fakeBackend({ message: "Hi Jane, ...", subject: "Referral for SWE role" });

    const result = await generateDraft(d, {
      backend,
      profile: testProfile(),
      personId,
      playbook: "recruiter",
      channel: "email",
    });

    expect(result.draft).toBe("Subject: Referral for SWE role\n\nHi Jane, ...");
    const rows = listOutreach(d, { personId });
    expect(rows[0].channel).toBe("email");
  });

  it("rejects an invalid playbook before calling the backend", async () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe" });
    const { backend, requests } = fakeBackend({ message: "hi" });
    await expect(
      generateDraft(d, { backend, profile: testProfile(), personId, playbook: "cold_call" as never })
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("passes jobId through to the created outreach row and includes job info in the prompt", async () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe", relation: "engineer" });
    const jobId = seedJob(d, { title: "AI Infra New Grad" });
    const { backend, requests } = fakeBackend({ message: "hi" });

    const result = await generateDraft(d, {
      backend,
      profile: testProfile(),
      personId,
      playbook: "referral",
      jobId,
    });

    const rows = listOutreach(d, { personId });
    expect(rows[0].jobId).toBe(jobId);
    expect(result.outreachId).toBe(rows[0].id);
    expect(requests[0].prompt).toContain("AI Infra New Grad");
  });

  it("for a followup, includes the prior outreach's last thread_log entry in the prompt sent to the backend", async () => {
    const d = db();
    const personId = upsertPerson(d, { name: "Jane Doe", relation: "engineer" });
    const priorId = createOutreach(d, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
    appendThread(d, priorId, { dir: "sent", text: "hi" });
    appendThread(d, priorId, { dir: "received", text: "Sounds good, ping me next week" });

    const { backend, requests } = fakeBackend({ message: "Hi Jane, following up!" });
    await generateDraft(d, { backend, profile: testProfile(), personId, playbook: "followup" });

    expect(requests[0].prompt).toContain("Sounds good, ping me next week");
  });

  it("throws for an unknown personId", async () => {
    const d = db();
    const { backend } = fakeBackend({ message: "hi" });
    await expect(
      generateDraft(d, { backend, profile: testProfile(), personId: 9999, playbook: "coffee_chat" })
    ).rejects.toThrow();
  });
});

describe("multi-job referral drafts", () => {
  it("prompt lists every job title + link when given an array", () => {
    const req = buildDraftPrompt(
      testProfile(),
      { name: "Jane", company: "Google", role_title: "SWE", relation: "alum" },
      "referral",
      [
        { company: "Google", title: "SWE New Grad", applyUrl: "https://g/1" },
        { company: "Google", title: "SRE New Grad", applyUrl: "https://g/2" },
      ]
    );
    expect(req.prompt).toContain("SWE New Grad");
    expect(req.prompt).toContain("https://g/2");
    expect(req.system).toMatch(/up to 3|multiple roles|every role/i);
  });

  it("generateDraft with jobIds creates one outreach linked to all jobs", async () => {
    const d = db();
    const pid = upsertPerson(d, { name: "Jane", company: "Google" });
    const j1 = seedJob(d, { company: "Google", title: "SWE" });
    const j2 = seedJob(d, { company: "Google", title: "SRE" });
    const { backend, requests } = fakeBackend({ message: "Hi Jane" });
    const res = await generateDraft(d, { backend, profile: testProfile(), personId: pid, playbook: "referral", jobIds: [j1, j2] });
    expect(requests[0].prompt).toContain("SRE");
    expect(outreachJobIds(d, res.outreachId)).toEqual([j1, j2]);
  });
});

describe("connection-note variant", () => {
  it("linkedin drafts ask the model for a <=280-char note and store it", async () => {
    const d = db();
    const pid = upsertPerson(d, { name: "Jane", company: "Google" });
    const j1 = seedJob(d, { company: "Google", title: "SWE" });
    const { backend, requests } = fakeBackend({ message: "Long full message. With detail.", note: "Hi Jane, fellow Trojan — open to referring me for SWE at Google?" });
    const res = await generateDraft(d, { backend, profile: testProfile(), personId: pid, playbook: "referral", jobIds: [j1], channel: "linkedin" });
    expect(requests[0].prompt).toMatch(/200/);
    expect(res.draftNote).toBe("Hi Jane, fellow Trojan — open to referring me for SWE at Google?");
    expect(listOutreach(d, { jobId: j1 })[0].draftNote).toBe(res.draftNote);
  });

  it("falls back to a sentence-trim when the note is missing or over the cap; email drafts get none", async () => {
    const d = db();
    const pid = upsertPerson(d, { name: "Jane", company: "Google" });
    const long = "First sentence here. " + "Second sentence that is fairly long and keeps going on. ".repeat(6) + "Ask at the end?";
    const { backend } = fakeBackend({ message: long, note: "x".repeat(300) });
    expect(NOTE_MAX_CHARS).toBe(200);
    const res = await generateDraft(d, { backend, profile: testProfile(), personId: pid, playbook: "referral", channel: "linkedin" });
    expect(res.draftNote!.length).toBeLessThanOrEqual(200);
    expect(res.draftNote!.startsWith("First sentence here.")).toBe(true);
    const { backend: eb } = fakeBackend({ message: "hi", subject: "s" });
    const er = await generateDraft(d, { backend: eb, profile: testProfile(), personId: pid, playbook: "referral", channel: "email" });
    expect(er.draftNote).toBeNull();
  });

  it("trimToNote keeps whole sentences and hard-cuts a single overlong sentence", () => {
    expect(trimToNote("A. B. C.", 4)).toBe("A.");
    expect(trimToNote("x".repeat(300)).length).toBe(200);
    expect(trimToNote("Line one\n\nLine two.")).toBe("Line one Line two.");
  });
});

describe("shortenNote", () => {
  function seqBackend(notes: string[]): { backend: LlmBackend; calls: number } {
    const state = { calls: 0 };
    const backend: LlmBackend = {
      name: "seq",
      complete: async () => {
        const n = notes[Math.min(state.calls, notes.length - 1)];
        state.calls++;
        return { text: JSON.stringify({ note: n }), backend: "seq" };
      },
    };
    return { backend, get calls() { return state.calls; } } as { backend: LlmBackend; calls: number };
  }

  it("re-compresses an approved (pending_send) note to the live cap without touching status", async () => {
    const d = db();
    const pid = upsertPerson(d, { name: "Jane", company: "Google" });
    const id = createOutreach(d, { personId: pid, playbook: "referral", channel: "linkedin", draft: "Hi Jane, fellow Trojan. Long approved text. Would you refer me?", draftNote: "x".repeat(258) });
    d.prepare("UPDATE outreach SET status = 'pending_send' WHERE id = ?").run(id);
    const s = seqBackend(["y".repeat(230), "Hi Jane, fellow Trojan. Would you refer me?"]);
    const r = await shortenNote(d, { backend: s.backend, outreachId: id, max: 200 });
    expect(r).toEqual({ draftNote: "Hi Jane, fellow Trojan. Would you refer me?", source: "model" });
    expect(s.calls).toBe(2);
    const row = d.prepare("SELECT status, draft_note FROM outreach WHERE id = ?").get(id) as { status: string; draft_note: string };
    expect(row.status).toBe("pending_send");
    expect(row.draft_note).toBe(r.draftNote);
  });

  it("falls back to a trim after three overlong attempts; refuses sent rows", async () => {
    const d = db();
    const pid = upsertPerson(d, { name: "Jane", company: "Google" });
    const id = createOutreach(d, { personId: pid, playbook: "referral", channel: "linkedin", draft: "First short sentence. " + "Second sentence that is long enough to matter here. ".repeat(5) });
    const s = seqBackend(["z".repeat(500)]);
    const r = await shortenNote(d, { backend: s.backend, outreachId: id, max: 100 });
    expect(r.source).toBe("trim");
    expect(r.draftNote.length).toBeLessThanOrEqual(100);
    expect(s.calls).toBe(3);
    d.prepare("UPDATE outreach SET status = 'sent' WHERE id = ?").run(id);
    await expect(shortenNote(d, { backend: s.backend, outreachId: id, max: 100 })).rejects.toThrow(/pending_send/);
  });
});
