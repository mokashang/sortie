import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { parseProfile, saveProfile } from "@/lib/profile";
import { parseAction, searchJobs, applyToJob, addJob, runTool, type ToolDeps } from "@/assistant/tools";
import { answerChat, buildChatRequest, deltaGate, normalizeMessages } from "@/assistant/chat";
import type { LlmBackend, LlmRequest } from "@/llm/types";

const U = "legacy";

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
daily_minutes_budget: 90
`;

function setup(): { db: DB; deps: ToolDeps } {
  const db = openDb(":memory:");
  seedOwner(db);
  saveProfile(db, U, parseProfile(baseYaml));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-tools-"));
  const scorer: LlmBackend = {
    name: "scorer",
    complete: async (req: LlmRequest) => {
      const ids = [...req.prompt.matchAll(/<job id="(\d+)"/g)].map((m) => Number(m[1]));
      return { text: JSON.stringify(ids.map((id) => ({ job_id: id, direction: "swe_general", score: 85, skip: false, reason: "fits" }))), backend: "scorer" };
    },
  };
  return { db, deps: { backend: scorer, followup: { logDir }, fetchJd: async () => "Software Development Engineer Intern 2027. Build services in Java. ".repeat(6) } };
}

function seedJob(db: DB, company: string, title: string, opts: { status?: string; reason?: string; score?: number | null; url?: string } = {}): number {
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url, jd_text) VALUES (?,?,?,?,?,?)")
    .run(`fp-${Math.random()}`, company, title, "manual", opts.url ?? `https://${company.toLowerCase()}.example/jobs/${Math.random().toString(36).slice(2, 6)}`, "Build things.").lastInsertRowid as number;
  if (opts.score !== null) db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", opts.score ?? 80, 1);
  db.prepare("INSERT INTO applications (job_id, status, needs_manual_reason) VALUES (?,?,?)").run(id, opts.status ?? "matched", opts.reason ?? null);
  return id;
}

function queuedRuns(db: DB) {
  return db.prepare("SELECT id, kind, status, channel, options FROM executor_runs ORDER BY id").all() as { id: number; kind: string; status: string; channel: string; options: string }[];
}

describe("parseAction", () => {
  it("accepts the three tools and rejects everything else", () => {
    expect(parseAction('ACTION: {"tool":"search_jobs","query":"Amazon intern"}')).toEqual({ tool: "search_jobs", query: "Amazon intern" });
    expect(parseAction('  ACTION: {"tool":"apply","jobId":12,"force":true}')).toEqual({ tool: "apply", jobId: 12, jobIds: [12], force: true });
    expect(parseAction('ACTION: {"tool":"add_job","url":"https://x.example/j","company":"X","title":"SWE"}')).toMatchObject({ tool: "add_job", url: "https://x.example/j", company: "X", title: "SWE", location: null });
    expect(parseAction("Task #5 is running.")).toBeNull();
    // prose before the line (production 2026-09-20) still counts as the action
    expect(parseAction('我就投这条还在队列里的 #5223957。\nACTION: {"tool":"apply","jobId":5223957,"force":false}')).toEqual({ tool: "apply", jobId: 5223957, jobIds: [5223957], force: false });
    expect(parseAction('ACTION: {"tool":"apply","jobId":7}\n(then I will tell you)')).toEqual({ tool: "apply", jobId: 7, jobIds: [7], force: false });
    expect(() => parseAction('ACTION: {"tool":"delete_everything"}')).toThrow(/unknown tool/);
    expect(() => parseAction('ACTION: {"tool":"apply"}')).toThrow(/jobId/);
    expect(() => parseAction("ACTION: nope")).toBeNull;
  });
});

describe("searchJobs", () => {
  it("matches every word against company or title and reports the row's state", () => {
    const { db } = setup();
    seedJob(db, "Amazon", "Software Development Engineer Intern 2027 (Summer)");
    seedJob(db, "Amazon", "Applied Scientist", { status: "archived", reason: "PhD only" });
    seedJob(db, "Stripe", "Software Engineer Intern");
    seedJob(db, "Amazon", "SDE Intern, ROBOTICS - 2027", { score: 73 });
    const rows = searchJobs(db, U, "amazon 2027 summer intern");
    // best match first; the robotics row matches 3 of 4 words and still shows; Applied Scientist (1 of 4) does not
    expect(rows.map((r) => r.title)).toEqual(["Software Development Engineer Intern 2027 (Summer)", "SDE Intern, ROBOTICS - 2027"]);
    expect(searchJobs(db, U, "amazon").length).toBe(3);
    expect(searchJobs(db, U, "帮我投递 岗位").length).toBe(0);
  });
});

describe("applyToJob", () => {
  it("queues a targeted apply task for a job in the queue", async () => {
    const { db, deps } = setup();
    const id = seedJob(db, "Amazon", "SDE Intern 2027");
    const r = await applyToJob(db, U, id, false, "zh", deps);
    expect(r.event).toMatchObject({ tool: "apply", ok: true, jobId: id, company: "Amazon" });
    expect(r.observation).toMatch(/started task #\d+/);
    const runs = queuedRuns(db);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ kind: "apply", status: "queued", channel: "user_chrome" });
    expect(JSON.parse(runs[0].options)).toMatchObject({ jobIds: [id], mode: "direct" });
  });

  it("scores an unscored posting first, then queues it", async () => {
    const { db, deps } = setup();
    const id = seedJob(db, "Amazon", "SDE Intern 2027", { score: null, status: "discovered" });
    const r = await applyToJob(db, U, id, false, "en", deps);
    expect(r.observation).toMatch(/started task/);
    const m = db.prepare("SELECT score FROM matches WHERE user_id = ? AND job_id = ?").get(U, id) as { score: number };
    expect(m.score).toBe(85);
    expect(r.observation).toContain("score 85");
    expect(queuedRuns(db).length).toBe(1);
  });

  it("refuses an archived job unless forced, and explains why", async () => {
    const { db, deps } = setup();
    const id = seedJob(db, "Amazon", "Applied Scientist", { status: "archived", reason: "PhD only" });
    const r = await applyToJob(db, U, id, false, "en", deps);
    expect(r.event).toMatchObject({ ok: false, blocked: "PhD only" });
    expect(r.observation).toContain("archived: PhD only");
    expect(queuedRuns(db).length).toBe(0);
    const forced = await applyToJob(db, U, id, true, "en", deps);
    expect(forced.event.ok).toBe(true);
    expect((db.prepare("SELECT status FROM applications WHERE job_id = ?").get(id) as { status: string }).status).toBe("matched");
    expect(queuedRuns(db).length).toBe(1);
  });

  it("reports already-submitted, in-progress and unknown jobs without queueing", async () => {
    const { db, deps } = setup();
    const done = seedJob(db, "Stripe", "SWE New Grad", { status: "submitted" });
    db.prepare("UPDATE applications SET submitted_at = '2026-09-02 10:00:00' WHERE job_id = ?").run(done);
    expect((await applyToJob(db, U, done, false, "en", deps)).observation).toMatch(/already submitted/);
    const waiting = seedJob(db, "Datadog", "SWE Intern", { status: "awaiting_confirm" });
    expect((await applyToJob(db, U, waiting, false, "en", deps)).observation).toMatch(/already being handled/);
    expect((await applyToJob(db, U, 9999, false, "en", deps)).observation).toMatch(/no posting #9999/);
    expect(queuedRuns(db).length).toBe(0);
  });

  it("merges into an already queued targeted task", async () => {
    const { db, deps } = setup();
    const a = seedJob(db, "Amazon", "SDE Intern");
    const b = seedJob(db, "Amazon", "SDE II");
    await applyToJob(db, U, a, false, "en", deps);
    const r = await applyToJob(db, U, b, false, "en", deps);
    expect(r.event.merged).toBe(true);
    const runs = queuedRuns(db);
    expect(runs.length).toBe(1);
    expect(JSON.parse(runs[0].options).jobIds).toEqual([a, b]);
  });
});

describe("addJob", () => {
  it("adds a posting by link with its fetched description, then apply can score and queue it", async () => {
    const { db, deps } = setup();
    const r = await addJob(db, { url: "https://amazon.jobs/en/jobs/123", company: "Amazon", title: "SDE Intern 2027", location: "Seattle, WA" }, deps);
    expect(r.event).toMatchObject({ tool: "add_job", ok: true, company: "Amazon" });
    const job = db.prepare("SELECT id, source, jd_text FROM jobs WHERE apply_url = ?").get("https://amazon.jobs/en/jobs/123") as { id: number; source: string; jd_text: string };
    expect(job.source).toBe("manual");
    expect(job.jd_text.length).toBeGreaterThan(200);
    const again = await addJob(db, { url: "https://amazon.jobs/en/jobs/123", company: "Amazon", title: "SDE Intern 2027" }, deps);
    expect(again.observation).toContain(`already in the library as #${job.id}`);
    const applied = await runTool(db, U, { tool: "apply", jobId: job.id }, "en", deps);
    expect(applied.events[0].ok).toBe(true);
    expect(queuedRuns(db).length).toBe(1);
  });
});

describe("deltaGate", () => {
  it("swallows an ACTION line and streams anything else", () => {
    const out: string[] = [];
    const g = deltaGate((t) => out.push(t));
    g.push("AC");
    g.push("TION: {\"tool\":\"search_jobs\",\"query\":\"x\"}");
    g.finish();
    expect(out).toEqual([]);
    expect(g.isAction()).toBe(true);

    const out2: string[] = [];
    const g2 = deltaGate((t) => out2.push(t));
    g2.push("Act");
    g2.push("ually, task #5 is done.");
    g2.push(" More.");
    g2.finish();
    // "Act" is not a prefix of "ACTION:" (case matters), so it is released at once.
    expect(out2).toEqual(["Act", "ually, task #5 is done.", " More."]);
    expect(g2.isAction()).toBe(false);

    const out3: string[] = [];
    const g3 = deltaGate((t) => out3.push(t));
    g3.push("A");
    g3.finish();
    expect(out3).toEqual(["A"]);
  });

  it("streams prose before an ACTION line but never the line itself or anything after it", () => {
    const out: string[] = [];
    const g = deltaGate((t) => out.push(t));
    g.push("我就投这条还在队列里的 #52。\nAC");
    g.push("TION: {\"tool\":\"apply\",\"jobId\":52}\ntrailing");
    g.finish();
    expect(out).toEqual(["我就投这条还在队列里的 #52。\n"]);
    expect(g.isAction()).toBe(true);

    const out2: string[] = [];
    const g2 = deltaGate((t) => out2.push(t));
    g2.push("Line one\nA");
    g2.push("nd line two");
    g2.finish();
    // "A" is held (it could become ACTION:) and released together with the rest of the line
    expect(out2).toEqual(["Line one\n", "And line two"]);
  });
});

describe("answerChat with tools", () => {
  it("searches, applies and then answers; only the answer is streamed", async () => {
    const { db, deps } = setup();
    const id = seedJob(db, "Amazon", "SDE Intern 2027 Summer");
    const prompts: string[] = [];
    const backend: LlmBackend = {
      name: "fake",
      complete: async (req) => {
        prompts.push(req.prompt);
        if (prompts.length === 1) return { text: 'ACTION: {"tool":"search_jobs","query":"Amazon 2027 summer intern"}', backend: "fake" };
        if (prompts.length === 2) return { text: `ACTION: {"tool":"apply","jobId":${id}}`, backend: "fake" };
        return { text: "已开始投递 Amazon SDE Intern 2027 Summer,任务 #1。", backend: "fake" };
      },
    };
    const deltas: string[] = [];
    const events: unknown[] = [];
    const r = await answerChat(db, U, "zh", [{ role: "user", content: "帮我投 Amazon 的 2027 summer intern" }], {
      backend,
      onDelta: (t) => deltas.push(t),
      onEvent: (e) => events.push(e),
      toolDeps: deps,
    });
    expect(prompts.length).toBe(3);
    expect(prompts[1]).toContain("TOOL RESULT: search_jobs: 1 matching posting(s)");
    expect(prompts[1]).toContain(`#${id} · Amazon · SDE Intern 2027 Summer`);
    expect(prompts[2]).toMatch(/TOOL RESULT: apply: started task #\d+/);
    expect(deltas).toEqual(["已开始投递 Amazon SDE Intern 2027 Summer,任务 #1。"]);
    expect(r.events.map((e) => e.tool)).toEqual(["search_jobs", "apply"]);
    expect(r.events[1]).toMatchObject({ ok: true, jobId: id });
    expect(queuedRuns(db).length).toBe(1);
  });

  it("runs an action the model put after a sentence, and later turns see what was done", async () => {
    const { db, deps } = setup();
    const id = seedJob(db, "Amazon", "SDE Intern Summer 2027");
    const prompts: string[] = [];
    const backend: LlmBackend = {
      name: "chatty",
      complete: async (req) => {
        prompts.push(req.prompt);
        if (prompts.length === 1) return { text: `我就投这条还在队列里的 #${id}。\nACTION: {"tool":"apply","jobId":${id},"force":false}`, backend: "chatty" };
        return { text: "已开始投递。", backend: "chatty" };
      },
    };
    const deltas: string[] = [];
    const r = await answerChat(db, U, "zh", [{ role: "user", content: "这不都一样吗" }], { backend, onDelta: (t) => deltas.push(t), toolDeps: deps });
    expect(r.events[0]).toMatchObject({ tool: "apply", ok: true, jobId: id });
    expect(deltas.join("")).not.toContain("ACTION");
    expect(r.text).toBe("已开始投递。");
    expect(queuedRuns(db).length).toBe(1);

    // the next turn's transcript carries what the earlier turn did
    const req = buildChatRequest({
      snapshot: "",
      lang: "zh",
      messages: [
        { role: "user", content: "帮我投" },
        { role: "assistant", content: "已开始投递。", actions: r.events },
        { role: "user", content: "开始投递了吗" },
      ],
    });
    expect(req.prompt).toContain("(did: started task");
    expect(req.prompt).toMatch(/started task #\d+ for Amazon — SDE Intern Summer 2027/);
    expect(normalizeMessages([{ role: "assistant", content: "x", actions: [{ tool: "apply", ok: true, runId: 3 }] }, { role: "user", content: "y" }])[0].actions).toEqual([{ tool: "apply", ok: true, runId: 3 }]);
  });

  it("tells the model about a malformed action and gives up after too many rounds", async () => {
    const { db, deps } = setup();
    let n = 0;
    const backend: LlmBackend = {
      name: "loop",
      complete: async () => {
        n++;
        return { text: 'ACTION: {"tool":"search_jobs","query":"amazon"}', backend: "loop" };
      },
    };
    const deltas: string[] = [];
    const r = await answerChat(db, U, "en", [{ role: "user", content: "apply to amazon" }], { backend, onDelta: (t) => deltas.push(t), toolDeps: deps });
    expect(r.text).toMatch(/could not finish/i);
    expect(deltas).toEqual([r.text]);
    expect(n).toBe(9); // MAX_TOOL_ROUNDS tool calls, then one more turn that is cut off

    const bad: LlmBackend = {
      name: "bad",
      complete: async (req) => (req.prompt.includes("ACTION error") ? { text: "Sorry, say that again?", backend: "bad" } : { text: 'ACTION: {"tool":"nuke"}', backend: "bad" }),
    };
    const r2 = await answerChat(db, U, "en", [{ role: "user", content: "x" }], { backend: bad, toolDeps: deps });
    expect(r2.text).toBe("Sorry, say that again?");
  });
});

// 「上网找」 (find_online): borrows the chat model's web tools; only the subscription backend has them.
import { findOnline, parseOnlinePostings } from "@/assistant/tools";

describe("find_online", () => {
  it("parses the JSON array the web step answers with and drops aggregators / junk", () => {
    const text = 'Here you go:\n[{"url":"https://www.amazon.jobs/en/jobs/1/sde-intern","company":"Amazon","title":"SDE Intern – Jan 2027","location":"USA"},{"url":"https://www.linkedin.com/jobs/view/1","company":"Amazon","title":"x","location":null},{"url":"notaurl","company":"A","title":"B"},{"url":"https://boards.greenhouse.io/x/jobs/2","company":"","title":"B"}]';
    expect(parseOnlinePostings(text)).toEqual([{ url: "https://www.amazon.jobs/en/jobs/1/sde-intern", company: "Amazon", title: "SDE Intern – Jan 2027", location: "USA" }]);
    expect(parseOnlinePostings("no json here")).toEqual([]);
    expect(parseAction('ACTION: {"tool":"find_online","query":"Amazon SDE intern winter 2027"}')).toEqual({ tool: "find_online", query: "Amazon SDE intern winter 2027" });
  });

  it("refuses without the subscription backend, and otherwise lists postings with their library state", async () => {
    const { db, deps } = setup();
    const codex: LlmBackend = { name: "codex", complete: async () => ({ text: "[]", backend: "codex" }) };
    const refused = await findOnline(db, U, "amazon intern", { ...deps, chatBackend: codex });
    expect(refused.event).toMatchObject({ tool: "find_online", ok: false, blocked: "no_web_tools" });

    const known = seedJob(db, "Amazon", "SDE Intern – Jan 2027", { url: "https://www.amazon.jobs/en/jobs/1/sde-intern" });
    const seen: LlmRequest[] = [];
    const sub: LlmBackend = {
      name: "subscription",
      complete: async (req) => {
        seen.push(req);
        return {
          text: '[{"url":"https://www.amazon.jobs/en/jobs/1/sde-intern","company":"Amazon","title":"SDE Intern – Jan 2027","location":"USA"},{"url":"https://www.amazon.jobs/en/jobs/2/sde-intern-may","company":"Amazon","title":"SDE Intern – May 2027","location":"USA"}]',
          backend: "subscription",
        };
      },
    };
    const r = await findOnline(db, U, "Amazon SDE intern winter spring 2027", { ...deps, chatBackend: sub });
    expect(seen[0]).toMatchObject({ bare: true, webTools: true, tier: "smart" });
    expect(seen[0].prompt).toContain("Amazon SDE intern winter spring 2027");
    expect(r.event).toMatchObject({ tool: "find_online", ok: true, count: 2 });
    expect(r.observation).toContain(`already in the library as #${known}`);
    expect(r.observation).toContain("https://www.amazon.jobs/en/jobs/2/sde-intern-may · not in the library — add_job");
    const none = await findOnline(db, U, "x", { ...deps, chatBackend: { name: "subscription", complete: async () => ({ text: "[]", backend: "subscription" }) } });
    expect(none.event).toMatchObject({ ok: true, count: 0 });
  });
});

// 「读正文」 (read_posting) and the batch forms of apply / add_job.
import { parsePostingFacts, readPostings } from "@/assistant/tools";

describe("read_posting and batch tools", () => {
  it("parses actions with several ids / jobs / urls", () => {
    expect(parseAction('ACTION: {"tool":"apply","jobIds":[3,4,4]}')).toEqual({ tool: "apply", jobId: 3, jobIds: [3, 4], force: false });
    expect(parseAction('ACTION: {"tool":"read_posting","urls":["https://a.example/1","bad","https://a.example/1"]}')).toEqual({ tool: "read_posting", urls: ["https://a.example/1"] });
    expect(() => parseAction('ACTION: {"tool":"read_posting","urls":[]}')).toThrow(/urls/);
    const add = parseAction('ACTION: {"tool":"add_job","jobs":[{"url":"https://a.example/1","company":"A","title":"T1"},{"url":"https://a.example/2","company":"A","title":"T2","location":"Seattle"}]}');
    expect(add?.tool === "add_job" && add.jobs?.length).toBe(2);
  });

  it("turns the extraction JSON into facts per url, unknown urls included", () => {
    const facts = parsePostingFacts(
      '```json\n[{"url":"https://a.example/1","title":"SDE Intern","company":"A","location":"Bengaluru, India","start":"January 2027","duration":"6 month","graduationWindow":"graduating in 2027","degree":"Bachelor or above","sponsorship":null,"usBased":false,"requirements":"x | y","closed":false}]\n```',
      ["https://a.example/1", "https://a.example/2"]
    );
    expect(facts[0]).toMatchObject({ url: "https://a.example/1", usBased: false, start: "January 2027", sponsorship: null });
    expect(facts[1]).toMatchObject({ url: "https://a.example/2", title: null, closed: false });
    expect(parsePostingFacts("garbage", ["https://a.example/1"])[0].title).toBeNull();
  });

  it("feeds fetched text to the extraction call, asks for web tools only for pages without text, and reports library state", async () => {
    const { db, deps } = setup();
    const known = seedJob(db, "Amazon", "SDE Intern", { url: "https://www.amazon.jobs/en/jobs/1/x" });
    const seen: LlmRequest[] = [];
    const sub: LlmBackend = {
      name: "subscription",
      complete: async (req) => {
        seen.push(req);
        return {
          text: JSON.stringify([
            { url: "https://www.amazon.jobs/en/jobs/1/x", title: "SDE Intern", company: "Amazon", location: "Seattle, WA", start: "May 2027", duration: "12 weeks", graduationWindow: "graduate between Oct 2027 and Sep 2029", degree: "BS/MS", sponsorship: null, usBased: true, requirements: "Java | Python", closed: false },
            { url: "https://www.amazon.jobs/en/jobs/2/y", closed: true },
          ]),
          backend: "subscription",
        };
      },
    };
    const long = "Basic qualifications: ".repeat(60);
    const cache = new Map<string, string>();
    const r = await readPostings(db, U, ["https://www.amazon.jobs/en/jobs/1/x", "https://www.amazon.jobs/en/jobs/2/y"], {
      ...deps,
      chatBackend: sub,
      jdCache: cache,
      fetchJd: async (u) => (u.endsWith("/1/x") ? long : null),
    });
    expect(seen[0]).toMatchObject({ bare: true, webTools: true });
    expect(seen[0].prompt).toContain(`<posting url="https://www.amazon.jobs/en/jobs/1/x">`);
    expect(seen[0].prompt).toContain("Basic qualifications");
    expect(seen[0].prompt).toContain("(no text captured — open this url with WebFetch)");
    expect(cache.get("https://www.amazon.jobs/en/jobs/1/x")).toBe(long);
    expect(r.event).toMatchObject({ tool: "read_posting", ok: true, count: 2 });
    expect(r.observation).toContain(`in library as #${known}`);
    expect(r.observation).toContain("graduation window: graduate between Oct 2027 and Sep 2029");
    expect(r.observation).toContain("POSTING CLOSED");

    // all pages had text → no web tools needed
    seen.length = 0;
    await readPostings(db, U, ["https://www.amazon.jobs/en/jobs/1/x"], { ...deps, chatBackend: sub, jdCache: cache, fetchJd: async () => long });
    expect(seen[0].webTools).toBe(false);

    const codex: LlmBackend = { name: "codex", complete: async () => ({ text: "[]", backend: "codex" }) };
    expect((await readPostings(db, U, ["https://a.example/1"], { ...deps, chatBackend: codex })).event.blocked).toBe("no_web_tools");
  });

  it("applies to several jobs in one call and adds several postings in one call", async () => {
    const { db, deps } = setup();
    const a = seedJob(db, "Amazon", "SDE Intern May 2027");
    const b = seedJob(db, "Amazon", "SDE Intern Jan 2027");
    const out = await runTool(db, U, { tool: "apply", jobId: a, jobIds: [a, b] }, "en", deps);
    expect(out.events.map((e) => e.ok)).toEqual([true, true]);
    expect(out.observation.match(/started task/g)?.length).toBe(2);
    const added = await runTool(
      db,
      U,
      { tool: "add_job", url: "https://x.example/1", company: "X", title: "T1", jobs: [{ url: "https://x.example/1", company: "X", title: "T1" }, { url: "https://x.example/2", company: "X", title: "T2", location: null }] },
      "en",
      deps
    );
    expect(added.events.map((e) => e.ok)).toEqual([true, true]);
    expect(db.prepare("SELECT COUNT(*) n FROM jobs WHERE apply_url LIKE 'https://x.example/%'").get()).toEqual({ n: 2 });
  });
});
