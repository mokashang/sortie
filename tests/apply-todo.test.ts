import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { parseProfile } from "@/lib/profile";
import {
  takeNextApplication,
  reportFill,
  decide,
  confirmStatus,
  unpark,
  unarchive,
  normalizeQuestions,
  pausesImmediately,
  openLoginWalls,
  siteKey,
  ApplyTask,
  InfoQuestion,
} from "@/apply/queue";
import { pendingInfo, answerInfo, resolveLogin, resolveLogins, listLoginWalls, needsInfoNotification } from "@/apply/info";
import { recordExternalSubmission, archiveManual, applicationHistory } from "@/apply/history";
import { upsertBoards, getBoard } from "@/scanner/boards";
import { createExperience } from "@/resume/experiences";

// The 待处理 list (spec 2026-09-13-todo-list-design): typed to-do items replace the dead-end
// 需人工 bucket. Every way the assistant can stop must leave behind a card with a way forward,
// and dead links / already-applied never become cards at all.

const yaml = `
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
directions:
  swe_general: 1
standard_answers:
  city: "Los Angeles, CA"
`;
const profile = parseProfile(yaml);
// Every in-memory test db gets the owner account (U = the legacy bucket) so rows seeded without
// a user_id and the account-scoped signatures line up (tests/helpers.ts).
const U = "legacy";
function openTestDb(): DB {
  const db = openDb(":memory:");
  seedOwner(db, U);
  return db;
}

function seed(
  db: DB,
  opts: { status?: string; applyUrl?: string; boardKey?: string | null; company?: string; title?: string; score?: number } = {}
): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source, board_key) VALUES (?,?,?,?,?,?)")
    .run(`fp-${Math.random()}`, opts.company ?? "Acme", opts.title ?? "SWE New Grad", opts.applyUrl ?? "https://boards.greenhouse.io/acme/jobs/1", "manual", opts.boardKey ?? null)
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "swe_general", opts.score ?? 85, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, opts.status ?? "prepared");
  return jobId;
}
function seedResume(db: DB): void {
  db.prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)").run("swe_general_v1", JSON.stringify(["swe_general"]), "/data/resumes/swe_general_v1.pdf", "2026-01-01 00:00:00");
}
const app = (db: DB, id: number) => db.prepare("SELECT * FROM applications WHERE job_id=?").get(id) as Record<string, unknown>;
const items = (db: DB, id: number) => JSON.parse(app(db, id).pending_questions as string) as Record<string, unknown>[];

const LOGIN: InfoQuestion = { kind: "login", key: "apple_id", label: "在求职 Chrome 里登录 Apple ID", url: "https://jobs.apple.com/en-us/login", host: "jobs.apple.com", hint: "Apple Jobs 提交简历要登录" };

describe("to-do items: normalization", () => {
  it("defaults kind to text, derives a login host from its url, drops unknown kinds and junk", () => {
    const out = normalizeQuestions([
      { key: "gpa", label: "GPA" },
      { key: "x", label: "Wall", kind: "login", url: "https://Career-hcm20.ns2cloud.com/careers?company=L3" },
      { key: "y", label: "Weird", kind: "teleport" },
      { key: "", label: "no key" },
      { label: "no key at all" },
      { key: "stack", label: "Stacks", options: ["Go", "", "Rust"], multiple: true },
      { key: "lonely", label: "multiple without options", multiple: true },
    ]);
    expect(out).toEqual([
      { key: "gpa", label: "GPA" },
      { key: "x", label: "Wall", kind: "login", url: "https://Career-hcm20.ns2cloud.com/careers?company=L3", host: "career-hcm20.ns2cloud.com" },
      { key: "y", label: "Weird" },
      { key: "stack", label: "Stacks", options: ["Go", "Rust"], multiple: true },
      { key: "lonely", label: "multiple without options" },
    ]);
    expect(pausesImmediately(out)).toBe(true);
    expect(pausesImmediately([{ key: "a", label: "A" }, { key: "f", label: "F", kind: "file" }, { key: "c", label: "C", kind: "action" }])).toBe(false);
  });
});

describe("login walls", () => {
  it("a login item pauses the application right away (the assistant moves on) and shows as a card", () => {
    const db = openTestDb();
    const jobId = seed(db, { applyUrl: "https://jobs.apple.com/en-us/details/1" });
    reportFill(db, U, { jobId, status: "needs_info", questions: [LOGIN] });
    expect(app(db, jobId).status).toBe("matched");
    expect(app(db, jobId).needs_manual_reason).toBe(LOGIN.label);
    expect(items(db, jobId)[0]).toMatchObject({ kind: "login", host: "jobs.apple.com" });
    expect(confirmStatus(db, U, jobId).status).toBe("matched");
    const cards = pendingInfo(db, U);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ jobId, status: "matched", questions: [expect.objectContaining({ kind: "login" })] });
    expect(openLoginWalls(db, U).get("jobs.apple.com")).toMatchObject({ label: LOGIN.label });
  });

  it("the picker pauses other jobs on the same host with the same item instead of handing them out", () => {
    const db = openTestDb();
    seedResume(db);
    const walled = seed(db, { applyUrl: "https://jobs.apple.com/en-us/details/1" });
    reportFill(db, U, { jobId: walled, status: "needs_info", questions: [LOGIN] });
    const sibling = seed(db, { status: "matched", applyUrl: "https://jobs.apple.com/en-us/details/2", score: 99 });
    const other = seed(db, { status: "matched", applyUrl: "https://boards.greenhouse.io/acme/jobs/9", score: 50 });

    const task = takeNextApplication(db, U, profile) as ApplyTask;
    expect(task.jobId).toBe(other);
    expect(app(db, sibling).status).toBe("matched");
    expect(app(db, sibling).needs_manual_reason).toBe(LOGIN.label);
    expect(items(db, sibling)[0]).toMatchObject({ kind: "login", host: "jobs.apple.com" });
    // both paused rows sit on one host → one 登录一次 card's worth of walls
    expect([...openLoginWalls(db, U).keys()]).toEqual(["jobs.apple.com"]);
  });

  it("我登好了 clears every paused job on that host so they can be re-queued, and leaves other items waiting", () => {
    const db = openTestDb();
    const a = seed(db, { applyUrl: "https://jobs.apple.com/en-us/details/1" });
    const b = seed(db, { applyUrl: "https://jobs.apple.com/en-us/details/2" });
    const c = seed(db, { applyUrl: "https://l3.example/x" });
    reportFill(db, U, { jobId: a, status: "needs_info", questions: [LOGIN] });
    reportFill(db, U, { jobId: b, status: "needs_info", questions: [LOGIN, { key: "gpa", label: "GPA" }] });
    reportFill(db, U, { jobId: c, status: "needs_info", questions: [{ ...LOGIN, host: "career-hcm20.ns2cloud.com", label: "注册 L3Harris 候选人账号" }] });

    const r = resolveLogin(db, U, "JOBS.APPLE.COM");
    expect(r).toEqual({ jobIds: [a], touched: 2 });
    expect(app(db, a).needs_manual_reason).toBeNull();
    expect(app(db, a).pending_questions).toBeNull();
    expect(app(db, a).status).toBe("matched"); // pickable again
    // b still owes a GPA: item list shrank, card stays
    expect(items(db, b)).toEqual([{ key: "gpa", label: "GPA" }]);
    expect(app(db, b).needs_manual_reason).toBe("GPA");
    // c is behind a different wall
    expect(items(db, c)[0]).toMatchObject({ kind: "login", host: "career-hcm20.ns2cloud.com" });
    expect(openLoginWalls(db, U).has("jobs.apple.com")).toBe(false);
    expect(() => resolveLogin(db, U, "  ")).toThrow();
  });

  it("全部去登录 / 全部登好了: one entry per site with its page, and every site released at once", () => {
    const db = openTestDb();
    const a = seed(db, { applyUrl: "https://jobs.apple.com/en-us/details/1" });
    const b = seed(db, { applyUrl: "https://jobs.apple.com/en-us/details/2" });
    const c = seed(db, { applyUrl: "https://l3.example/x" });
    const d = seed(db, { applyUrl: "https://careers.acme.com/x" });
    reportFill(db, U, { jobId: a, status: "needs_info", questions: [LOGIN] });
    reportFill(db, U, { jobId: b, status: "needs_info", questions: [{ ...LOGIN, host: "www.jobs.apple.com" }] });
    reportFill(db, U, { jobId: c, status: "needs_info", questions: [{ kind: "login", key: "l3", label: "注册 L3Harris", host: "career-hcm20.ns2cloud.com" }] });
    reportFill(db, U, { jobId: d, status: "needs_info", questions: [{ kind: "login", key: "acme", label: "Acme", host: "careers.acme.com", url: "javascript:alert(1)" }] });

    expect(listLoginWalls(db, U)).toEqual([
      { host: "jobs.apple.com", url: "https://jobs.apple.com/en-us/login", label: LOGIN.label, jobs: 2 },
      { host: "career-hcm20.ns2cloud.com", url: "https://career-hcm20.ns2cloud.com", label: "注册 L3Harris", jobs: 1 },
      { host: "careers.acme.com", url: "https://careers.acme.com", label: "Acme", jobs: 1 },
    ]);

    const r = resolveLogins(db, U, ["jobs.apple.com", "career-hcm20.ns2cloud.com"]);
    expect(r.jobIds.sort()).toEqual([a, b, c].sort());
    expect(listLoginWalls(db, U).map((w) => w.host)).toEqual(["careers.acme.com"]);
  });

  it("a LinkedIn posting's wall is keyed on the company site, and www. shares the wall", () => {
    const out = normalizeQuestions([
      { key: "wd", label: "Workday", kind: "login", host: "www.linkedin.com", url: "https://nvidia.wd5.myworkdayjobs.com/login" },
    ]);
    expect(out[0].host).toBe("nvidia.wd5.myworkdayjobs.com");
    expect(siteKey("WWW.Foo.com")).toBe("foo.com");

    const db = openTestDb();
    seedResume(db);
    const walled = seed(db, { applyUrl: "https://www.acme.com/jobs/1" });
    reportFill(db, U, { jobId: walled, status: "needs_info", questions: [{ kind: "login", key: "acme", label: "Acme", host: "www.acme.com" }] });
    const sibling = seed(db, { status: "matched", applyUrl: "https://acme.com/jobs/2", score: 99 });
    expect(takeNextApplication(db, U, profile)).toEqual({ done: true });
    expect(app(db, sibling).needs_manual_reason).toBe("Acme");
  });
});

describe("files, actions and multi-select answers", () => {
  it("a file answer is stored on the application but never remembered as a standard answer", () => {
    const db = openTestDb();
    const jobId = seed(db);
    reportFill(db, U, {
      jobId,
      status: "needs_info",
      questions: [
        { key: "transcript", label: "Please provide a recent transcript", kind: "file", accept: ".pdf" },
        { key: "gpa", label: "GPA" },
      ],
    });
    expect(app(db, jobId).status).toBe("needs_info"); // the assistant waits on the tab for these
    let persisted: Record<string, string> | null = null;
    const r = answerInfo(db, U, jobId, { transcript: { value: "E:/sortie/data/documents/transcript.pdf" }, gpa: { value: "3.9" } }, (p) => (persisted = p));
    expect(r).toEqual({ remembered: { gpa: "3.9" }, status: "prepared" });
    expect(persisted).toEqual({ gpa: "3.9" });
    expect(confirmStatus(db, U, jobId).infoAnswers).toEqual({ transcript: "E:/sortie/data/documents/transcript.pdf", gpa: "3.9" });
  });

  it("an action item is answered with 'done' and never remembered; a required one can't be skipped", () => {
    const db = openTestDb();
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: [{ key: "captcha", label: "在打开的标签页里完成人机验证", kind: "action" }] });
    expect(() => answerInfo(db, U, jobId, {}, () => {})).toThrow(/missing answer/);
    let persisted: Record<string, string> | null = null;
    const r = answerInfo(db, U, jobId, { captcha: { value: "done" } }, (p) => (persisted = p));
    expect(r).toEqual({ remembered: {}, status: "prepared" });
    expect(persisted).toBeNull();
  });

  it("a multi-select answer must be a subset of the options and is normalized to the option order", () => {
    const db = openTestDb();
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: [{ key: "tech_stacks", label: "Stacks", options: ["Python", "Go", "Rust"], multiple: true }] });
    expect(() => answerInfo(db, U, jobId, { tech_stacks: { value: "Python; COBOL" } }, () => {})).toThrow(/not one of the options/);
    const r = answerInfo(db, U, jobId, { tech_stacks: { value: "Rust;  Python " } }, () => {});
    expect(r.remembered).toEqual({ tech_stacks: "Rust; Python" });
  });
});

describe("cards that only the user can move", () => {
  it("a manual item pauses right away; 让助手再试一次 clears reason and items", () => {
    const db = openTestDb();
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: [{ key: "video", label: "要录一段 60 秒视频", kind: "manual", url: "https://acme.example/video" }] });
    expect(app(db, jobId).status).toBe("matched");
    expect(pendingInfo(db, U)[0].questions[0]).toMatchObject({ kind: "manual", url: "https://acme.example/video" });
    unpark(db, U, jobId);
    expect(app(db, jobId).needs_manual_reason).toBeNull();
    expect(app(db, jobId).pending_questions).toBeNull();
  });

  it("an error report becomes a card with the reason as its hint", () => {
    const db = openTestDb();
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "error", reason: "tab crashed twice" });
    expect(app(db, jobId).needs_manual_reason).toBe("error: tab crashed twice");
    expect(items(db, jobId)).toEqual([{ key: "error", label: "助手出错,没填成", kind: "manual", hint: "tab crashed twice" }]);
  });

  it("a rejected fill becomes a card and the reason rides along into the next answer pack", () => {
    const db = openTestDb();
    seedResume(db);
    const jobId = seed(db, { status: "awaiting_confirm" });
    decide(db, U, jobId, "reject", "Boston was picked instead of Los Angeles");
    expect(items(db, jobId)).toEqual([{ key: "rejected", label: "你退回了这份填写", kind: "manual", hint: "Boston was picked instead of Los Angeles" }]);
    expect(pendingInfo(db, U).map((c) => c.jobId)).toEqual([jobId]);
    unpark(db, U, jobId);
    const task = takeNextApplication(db, U, profile, { jobIds: [jobId] }) as ApplyTask;
    expect(task.answerPack.custom.rejection_note).toBe("Boston was picked instead of Los Angeles");
  });

  it("a legacy needs_manual without items synthesizes one; with items (info timeout) the items survive", () => {
    const db = openTestDb();
    const plain = seed(db);
    reportFill(db, U, { jobId: plain, status: "needs_manual", reason: "CAPTCHA on submit page" });
    expect(items(db, plain)).toEqual([{ key: "manual", label: "助手没能完成这份申请", kind: "manual", hint: "CAPTCHA on submit page" }]);

    const waiting = seed(db);
    reportFill(db, U, { jobId: waiting, status: "needs_info", questions: [{ key: "gpa", label: "GPA" }] });
    reportFill(db, U, { jobId: waiting, status: "needs_manual", reason: "info request timed out after 30 minutes" });
    expect(app(db, waiting).status).toBe("matched");
    expect(items(db, waiting)).toEqual([{ key: "gpa", label: "GPA" }]);
    // answering the paused row clears it for a re-queue
    expect(answerInfo(db, U, waiting, { gpa: { value: "3.8" } }, () => {}).status).toBe("matched");
    expect(app(db, waiting).needs_manual_reason).toBeNull();
  });

  it("a paused row with only a reason (pre-design data) still renders as a manual card", () => {
    const db = openTestDb();
    const jobId = seed(db, { status: "matched" });
    db.prepare("UPDATE applications SET needs_manual_reason = ? WHERE job_id = ?").run("login wall: Apple Jobs", jobId);
    expect(pendingInfo(db, U)[0].questions).toEqual([{ key: "manual", label: "助手没能完成这份申请", kind: "manual", hint: "login wall: Apple Jobs" }]);
  });

  it("the picker pauses a job with no resume for its direction as a card pointing at the resumes tab", () => {
    const db = openTestDb();
    const jobId = seed(db, { status: "matched" });
    expect(takeNextApplication(db, U, profile)).toEqual({ done: true });
    expect(app(db, jobId).needs_manual_reason).toContain("no resume generated");
    expect(items(db, jobId)[0]).toMatchObject({ key: "no_resume", kind: "manual", url: "/profile?tab=resumes" });
  });

  it("跳过这个岗 archives paused and waiting rows alike, and undo returns them to the queue clean", () => {
    const db = openTestDb();
    const waiting = seed(db);
    reportFill(db, U, { jobId: waiting, status: "needs_info", questions: [{ key: "gpa", label: "GPA" }] });
    const paused = seed(db);
    reportFill(db, U, { jobId: paused, status: "error", reason: "x" });
    const clean = seed(db, { status: "matched" });
    expect(archiveManual(db, U, [waiting, paused, clean])).toEqual({ archived: 2, skipped: [clean] });
    expect(app(db, waiting).status).toBe("archived");
    expect(app(db, waiting).needs_manual_reason).toBe("user gave up");
    expect(app(db, paused).needs_manual_reason).toBe("error: x");
    unarchive(db, U, waiting);
    expect(app(db, waiting)).toMatchObject({ status: "matched", needs_manual_reason: null, pending_questions: null });
  });
});

describe("handled without a card", () => {
  it("closed archives the application, marks the job's page closed and can mute the board", () => {
    const db = openTestDb();
    upsertBoards(db, [{ key: "ashby:cursor", company: "Anysphere", origin: "url" }]);
    const gone = seed(db, { boardKey: "ashby:cursor" });
    reportFill(db, U, { jobId: gone, status: "closed", reason: "whole Ashby board returns Page not found", boardGone: true });
    expect(app(db, gone).status).toBe("archived");
    expect(app(db, gone).needs_manual_reason).toBe("closed: whole Ashby board returns Page not found");
    expect((db.prepare("SELECT jd_status FROM jobs WHERE id=?").get(gone) as { jd_status: string }).jd_status).toBe("closed");
    expect(getBoard(db, "ashby:cursor")).toMatchObject({ tier: "muted", tier_reason: expect.stringContaining("board gone") });
    expect(pendingInfo(db, U)).toEqual([]);

    const single = seed(db, { boardKey: "greenhouse:acme" });
    reportFill(db, U, { jobId: single, status: "closed", reason: "posting no longer available" });
    expect(app(db, single).status).toBe("archived");
    expect(getBoard(db, "greenhouse:acme")).toBeUndefined(); // no board row, nothing to mute, no error
  });

  it("already_applied lands the job in the submitted history with a note, never as a card", () => {
    const db = openTestDb();
    const jobId = seed(db);
    reportFill(db, U, { jobId, status: "already_applied", reason: "You have already applied page" });
    expect(app(db, jobId).status).toBe("submitted");
    expect(app(db, jobId).submitted_at).toBeTruthy();
    const h = applicationHistory(db, U);
    expect(h).toHaveLength(1);
    expect(h[0].lastNote).toContain("此前已投过");
    expect(pendingInfo(db, U)).toEqual([]);
    // idempotent, and refused from a state that never had a form
    recordExternalSubmission(db, U, jobId, "again");
    const archived = seed(db, { status: "archived" });
    expect(() => recordExternalSubmission(db, U, archived, "x")).toThrow();
  });
});

describe("answer pack extras", () => {
  it("carries the standing documents and the direction's experience highlights", () => {
    const db = openTestDb();
    seedResume(db);
    createExperience(db, U, { kind: "project", title: "Sortie", organization: null, bullets: [{ text: "Built a job-application pipeline", directions: ["swe_general"] }], sort_order: 1 });
    createExperience(db, U, { kind: "skill", title: "Languages", organization: null, bullets: [{ text: "C++", directions: [] }], sort_order: 0 });
    seed(db, { status: "matched" });
    const task = takeNextApplication(db, U, profile, { documents: { transcript: "E:/sortie/data/documents/transcript.pdf" } }) as ApplyTask;
    expect(task.answerPack.documents).toEqual({ transcript: "E:/sortie/data/documents/transcript.pdf" });
    expect(task.answerPack.experiences).toEqual([{ kind: "project", title: "Sortie", organization: null, bullet: "Built a job-application pipeline" }]);
  });
});

describe("the assistant that asked is gone (its run failed or was reaped)", () => {
  it("answering re-queues the job instead of handing it to nobody, and 让助手重新来 works from a waiting card", () => {
    const db = openTestDb();
    const a = seed(db);
    reportFill(db, U, { jobId: a, status: "needs_info", questions: [{ key: "gpa", label: "GPA" }] });
    expect(answerInfo(db, U, a, { gpa: { value: "3.9" } }, () => {}, { executorWaiting: false }).status).toBe("matched");
    expect(app(db, a)).toMatchObject({ status: "matched", needs_manual_reason: null, pending_questions: null });
    expect(confirmStatus(db, U, a).infoAnswers).toEqual({ gpa: "3.9" });

    const b = seed(db);
    reportFill(db, U, { jobId: b, status: "needs_info", questions: [{ key: "gpa", label: "GPA" }] });
    unpark(db, U, b);
    expect(app(db, b)).toMatchObject({ status: "matched", needs_manual_reason: null, pending_questions: null });
    expect(pendingInfo(db, U)).toEqual([]);
  });

  it("with the executor still on the form, answering keeps the row for it (prepared)", () => {
    const db = openTestDb();
    const a = seed(db);
    reportFill(db, U, { jobId: a, status: "needs_info", questions: [{ key: "gpa", label: "GPA" }] });
    expect(answerInfo(db, U, a, { gpa: { value: "3.9" } }, () => {}, { executorWaiting: true }).status).toBe("prepared");
  });
});

describe("notifications", () => {
  it("say what kind of thing is needed", () => {
    expect(needsInfoNotification("Apple", "SWE", [LOGIN], "zh").title).toContain("登录一次");
    expect(needsInfoNotification("Databricks", "Intern", [{ key: "transcript", label: "Transcript", kind: "file" }], "zh").title).toContain("上传文件");
    expect(needsInfoNotification("X", "Y", [{ key: "video", label: "Video", kind: "manual" }], "zh").title).toContain("亲自处理");
    expect(needsInfoNotification("X", "Y", [{ key: "captcha", label: "Captcha", kind: "action" }], "zh").title).toContain("标签页");
    expect(needsInfoNotification("X", "Y", [{ key: "gpa", label: "GPA" }], "zh").body).toContain("待处理");
  });
});
