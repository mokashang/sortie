import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { RankingBusyError, rankedLoginUrl, rankedState, rankingBoard, retryRankedLogin, startRankedFrom, startRankedPicked } from "@/apply/ranking";
import { filterCompanies, filterCounts, pickable } from "@/app/lib/ranking";
import { seedOwner } from "./helpers";

const U = "legacy";

function job(db: DB, company: string, title: string, rank: number, position: number, fields: { status?: string; submitted?: boolean; questions?: object[]; reason?: string } = {}): number {
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${company}-${title}`, company, title, `https://${company.toLowerCase()}.example/${title.length}`, "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO applications (job_id, status, submitted_at, pending_questions, needs_manual_reason) VALUES (?,?,?,?,?)").run(
    id,
    fields.status ?? "matched",
    fields.submitted ? "2026-11-05 01:00:00" : null,
    fields.questions ? JSON.stringify(fields.questions) : null,
    fields.reason ?? null
  );
  db.prepare("INSERT OR IGNORE INTO ranked_companies (user_id, rank, company, value_label) VALUES (?,?,?,?)").run(U, rank, company, "$1T");
  db.prepare("INSERT INTO ranked_jobs (user_id, job_id, rank, position, score) VALUES (?,?,?,?,?)").run(U, id, rank, position, 80);
  return id;
}

function list(): { db: DB; todo: number; second: number; wall: number; card: number; done: number; gone: number } {
  const db = openDb(":memory:");
  seedOwner(db, U);
  const done = job(db, "Acme", "Done", 1, 0, { status: "submitted", submitted: true });
  const gone = job(db, "Acme", "Gone", 1, 1, { status: "archived", reason: "closed: page not found" });
  const wall = job(db, "Globex", "Wall", 2, 0, { reason: "Log in", questions: [{ kind: "login", key: "login", label: "Log in", host: "globex.example" }] });
  const card = job(db, "Globex", "Card", 2, 1, { status: "needs_info", questions: [{ kind: "action", key: "captcha", label: "Tick the box" }] });
  const todo = job(db, "Initech", "Todo", 3, 0);
  const second = job(db, "Initech", "Second", 3, 1);
  db.prepare("INSERT INTO ranked_companies (user_id, rank, company, note) VALUES (?,?,?,?)").run(U, 4, "Umbrella", "no jobs this round");
  return { db, todo, second, wall, card, done, gone };
}

describe("rankedState", () => {
  const row = { status: "matched", submitted_at: null, pending_questions: null, needs_manual_reason: null };
  it.each([
    [{ ...row }, "todo"],
    [{ ...row, status: "submitted", submitted_at: "2026-11-05" }, "submitted"],
    [{ ...row, status: "archived" }, "archived"],
    [{ ...row, status: "prepared" }, "active"],
    [{ ...row, status: "awaiting_confirm" }, "confirm"],
    [{ ...row, status: "awaiting_confirm", confirm_decision: "approved" }, "active"],
    [{ ...row, needs_manual_reason: "retry: error: tab froze" }, "active"],
    [{ ...row, needs_manual_reason: "x", pending_questions: '[{"kind":"login","key":"l","label":"l"}]' }, "login"],
    [{ ...row, needs_manual_reason: "submit blocked: x", pending_questions: '[{"kind":"submit","key":"s","label":"s"}]' }, "submit"],
    [{ ...row, status: "needs_info", pending_questions: '[{"kind":"action","key":"a","label":"a"}]' }, "action"],
    [{ ...row, status: "needs_info", pending_questions: '[{"key":"q","label":"q"}]' }, "text"],
    [{ ...row, needs_manual_reason: "an old reason with no items" }, "manual"],
  ])("%j is %s", (fields, state) => {
    expect(rankedState(fields)).toBe(state);
  });
});

describe("rankingBoard", () => {
  it("keeps rank order, counts by state, and says where the next job is", () => {
    const { db } = list();
    const b = rankingBoard(db, U);
    expect(b.companies.map((c) => c.company)).toEqual(["Acme", "Globex", "Initech", "Umbrella"]);
    expect(b.companies[0].jobs.map((j) => j.state)).toEqual(["submitted", "archived"]);
    expect(b.companies[0].jobs[1].detail).toMatch(/page not found/);
    expect(b.counts).toMatchObject({ submitted: 1, archived: 1, login: 1, action: 1, todo: 2 });
    expect(b.total).toBe(6);
    expect(b.nextRank).toBe(3);
    expect(b.run).toBeNull();
  });

  it("another account's list is not shown", () => {
    const { db } = list();
    expect(rankingBoard(db, "someone-else").companies).toEqual([]);
  });
});

describe("从这里往下投", () => {
  it("starts a list task on the jobs left, and only one at a time", () => {
    const { db, todo, second } = list();
    const r = startRankedFrom(db, U, 1);
    expect(r.jobs).toBe(2);
    const o = JSON.parse((db.prepare("SELECT options FROM executor_runs WHERE id = ?").get(r.runId) as { options: string }).options);
    expect(o.campaign.ids).toEqual([todo, second]);
    expect(o.campaign.all).toHaveLength(6);
    expect(rankingBoard(db, U).run?.id).toBe(r.runId);
    expect(() => startRankedFrom(db, U, 1)).toThrow(RankingBusyError);
  });

  it("nothing left from there down starts nothing", () => {
    const { db } = list();
    expect(startRankedFrom(db, U, 4)).toEqual({ runId: 0, jobs: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM executor_runs").get()).toEqual({ n: 0 });
  });
});

describe("投选中的", () => {
  it("queues jobs not started, hands a card back, and leaves walls and finished jobs alone", () => {
    const { db, todo, card, wall, done } = list();
    const r = startRankedPicked(db, U, [todo, card, wall, done]);
    expect(r.started.sort()).toEqual([todo, card].sort());
    expect(r.skipped.sort()).toEqual([wall, done].sort());
    expect(db.prepare("SELECT status, pending_questions FROM applications WHERE job_id = ?").get(card)).toEqual({ status: "matched", pending_questions: null });
    const o = JSON.parse((db.prepare("SELECT options FROM executor_runs WHERE id = ?").get(r.runId) as { options: string }).options);
    expect(o.jobIds.sort()).toEqual([todo, card].sort());
  });

  it("a job outside the list is ignored", () => {
    const { db } = list();
    expect(startRankedPicked(db, U, [999999])).toEqual({ runId: null, started: [], skipped: [] });
  });
});

describe("登好了,重试", () => {
  it("brings the site's wall down and queues only the list's jobs", () => {
    const { db, wall } = list();
    const other = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
      .run("fp-off-list", "Globex", "Off list", "https://globex.example/9", "manual").lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status, pending_questions, needs_manual_reason) VALUES (?,?,?,?)").run(
      other,
      "matched",
      JSON.stringify([{ kind: "login", key: "login", label: "Log in", host: "globex.example" }]),
      "Log in"
    );
    const r = retryRankedLogin(db, U, wall);
    expect(r).toMatchObject({ released: 2, queued: 1 });
    const o = JSON.parse((db.prepare("SELECT options FROM executor_runs WHERE id = ?").get(r.runId) as { options: string }).options);
    expect(o.jobIds).toEqual([wall]);
    expect(db.prepare("SELECT status, pending_questions, needs_manual_reason FROM applications WHERE job_id = ?").get(other)).toEqual({ status: "matched", pending_questions: null, needs_manual_reason: null });
  });

  it("a job with no wall does nothing", () => {
    const { db, todo } = list();
    expect(retryRankedLogin(db, U, todo)).toEqual({ released: 0, queued: 0, runId: null });
  });

  it("the sign-in page comes from the job's own login item", () => {
    const { db, wall, todo } = list();
    db.prepare("UPDATE applications SET pending_questions = ? WHERE job_id = ?").run(JSON.stringify([{ kind: "login", key: "login", label: "Log in", host: "globex.example", url: "https://globex.example/signin" }]), wall);
    expect(rankedLoginUrl(db, U, wall)).toBe("https://globex.example/signin");
    expect(rankedLoginUrl(db, U, todo)).toBeNull();
    expect(rankingBoard(db, U).companies[1].jobs[0].loginHost).toBe("globex.example");
  });
});

describe("the tab's filters", () => {
  const companies = [
    { rank: 1, company: "Acme", value: "$1T", note: null, jobs: [{ jobId: 1, title: "A", score: 80, state: "submitted" as const, detail: null, loginHost: null }, { jobId: 2, title: "B", score: 80, state: "login" as const, detail: null, loginHost: null }] },
    { rank: 2, company: "Globex", value: null, note: "skipped", jobs: [] },
    { rank: 3, company: "Initech", value: null, note: null, jobs: [{ jobId: 3, title: "C", score: 70, state: "todo" as const, detail: null, loginHost: null }] },
  ];

  it("keeps only the matching jobs, and note rows under 全部", () => {
    expect(filterCompanies(companies, "all", "").map((c) => c.rank)).toEqual([1, 2, 3]);
    expect(filterCompanies(companies, "you", "").map((c) => c.jobs.map((j) => j.jobId))).toEqual([[2]]);
    expect(filterCompanies(companies, "todo", "").map((c) => c.rank)).toEqual([3]);
    expect(filterCompanies(companies, "all", "glob").map((c) => c.rank)).toEqual([2]);
  });

  it("counts for the filter buttons", () => {
    expect(filterCounts(companies)).toEqual({ all: 3, todo: 1, you: 1, submitted: 1, archived: 0 });
  });

  it("a login wall or an unconfirmed fill can't be picked, a card can", () => {
    expect(pickable("confirm")).toBe(false);
    expect(pickable("login")).toBe(false);
    expect(pickable("action")).toBe(true);
    expect(pickable("todo")).toBe(true);
    expect(pickable("submitted")).toBe(false);
  });
});
