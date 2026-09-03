import { describe, it, expect, vi } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile, Profile } from "@/lib/profile";
import { upsertPerson, createOutreach, appendThread, listOutreach, outreachJobIds } from "@/network/crm";
import { buildDraftPrompt, generateDraft } from "@/network/draft";
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
    expect(req.system).toMatch(/280/); // connection-request character cap guidance
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
