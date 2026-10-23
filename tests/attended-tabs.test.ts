import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { saveSpawns, SpawnRecord } from "@/executor/sessions";
import { heldTabs, planTabReleases, sweepTabs, HeldTab, MAX_OPEN_TABS, STUCK_TAB_MS, SUBMIT_BLOCKED_REASON_PREFIX } from "@/executor/tabs";
import { approvedNotice, rejectedNotice, shutdownNotice } from "@/executor/attended-session";
import { attendedBusyDetail } from "@/executor/attended";
import { SUBMIT_BLOCKED_PREFIX } from "@/apply/queue";
import { seedOwner } from "./helpers";

// At most 30 tabs open, and none stuck for more than an hour (user, 2026-10-22).

const U = "legacy";
const NOW = Date.parse("2026-10-22T20:00:00.000Z");
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString().slice(0, 19).replace("T", " ");

function session(db: DB, pid: number): { rec: SpawnRecord; runId: number } {
  const runId = Number(
    db
      .prepare("INSERT INTO executor_runs (kind, status, channel, pid, claimed_at, started_at) VALUES ('apply','running','user_chrome',?,?,?)")
      .run(pid, minAgo(300), minAgo(300)).lastInsertRowid
  );
  return { rec: { pid, runId, startedAt: new Date(NOW - 301 * 60_000).toISOString(), logPath: "x.log" }, runId };
}

function job(db: DB, runId: number | null, status: string, updatedMinAgo: number, opts: { questions?: object[]; approved?: boolean } = {}): number {
  const id = Number(db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?, 'Acme', 'SWE', 'manual')").run(`fp-${Math.random()}`).lastInsertRowid);
  db.prepare("INSERT INTO applications (job_id, status, run_id, pending_questions, confirm_decision, updated_at) VALUES (?,?,?,?,?,?)").run(
    id,
    status,
    runId,
    opts.questions ? JSON.stringify(opts.questions) : null,
    opts.approved ? "approved" : null,
    minAgo(updatedMinAgo)
  );
  return id;
}

const tab = (jobId: number, sinceMinAgo: number, status = "awaiting_confirm"): HeldTab => ({ jobId, pid: 1, startedAt: "s", runId: 1, status, since: minAgo(sinceMinAgo) });

describe("planTabReleases", () => {
  it("closes every tab stuck past an hour", () => {
    const plan = planTabReleases([tab(1, 61), tab(2, 59), tab(3, 120)], 1, NOW);
    expect(plan.map((t) => [t.jobId, t.why])).toEqual([
      [3, "stuck"],
      [1, "stuck"],
    ]);
  });

  it("over the cap, the oldest go first; one anchor tab per session counts", () => {
    const held = Array.from({ length: 30 }, (_, i) => tab(i + 1, 50 - i));
    const plan = planTabReleases(held, 2, NOW);
    // 30 forms + 2 anchors = 32 > 30: the two oldest close.
    expect(plan.map((t) => [t.jobId, t.why])).toEqual([
      [1, "cap"],
      [2, "cap"],
    ]);
    expect(planTabReleases(held.slice(0, MAX_OPEN_TABS - 2), 2, NOW)).toEqual([]);
  });

  it("a form being filled with the user's answers counts but is never closed", () => {
    const held = [tab(1, 200, "prepared"), ...Array.from({ length: 29 }, (_, i) => tab(i + 2, 30))];
    const plan = planTabReleases(held, 1, NOW, { stuckMs: STUCK_TAB_MS });
    expect(plan.map((t) => t.jobId)).toEqual([2]); // 30 + 1 anchor = 31: one goes, not the prepared one
  });
});

describe("sweepTabs", () => {
  it("tells the owner to close the tab and detaches the job; only tabs that keep a form count", () => {
    const db = openDb(":memory:");
    const a = session(db, 101);
    saveSpawns(db, [a.rec]);
    const stuckFill = job(db, a.runId, "awaiting_confirm", 90, { approved: true });
    const freshFill = job(db, a.runId, "awaiting_confirm", 5);
    const question = job(db, a.runId, "needs_info", 70, { questions: [{ key: "q", label: "Q", kind: "text" }] });
    const login = job(db, a.runId, "needs_info", 300, { questions: [{ key: "l", label: "L", kind: "login", host: "x" }] });
    const other = job(db, null, "awaiting_confirm", 500);

    expect(heldTabs(db, U).map((t) => t.jobId).sort()).toEqual([stuckFill, freshFill, question].sort());
    const typed: [number, string][] = [];
    const r = sweepTabs(db, U, { now: NOW, reachable: () => true, write: (pid, line) => (typed.push([pid, line]), true) });

    expect(r.open).toBe(4); // three forms + the anchor
    expect(r.released.map((x) => x.jobId).sort()).toEqual([stuckFill, question].sort());
    expect(typed.map(([pid]) => pid)).toEqual([101, 101]);
    expect(typed[0][1]).toMatch(/^\[Sortie\] close job \d+: it has been waiting for over an hour/);
    const runOf = (id: number) => (db.prepare("SELECT run_id FROM applications WHERE job_id = ?").get(id) as { run_id: number | null }).run_id;
    expect(runOf(stuckFill)).toBeNull();
    expect(runOf(question)).toBeNull();
    expect(runOf(freshFill)).toBe(a.runId);
    expect(runOf(login)).toBe(a.runId);
    expect(runOf(other)).toBeNull();

    // Detached jobs are no longer this session's: a second sweep has nothing to close.
    expect(sweepTabs(db, U, { now: NOW, reachable: () => true, write: () => true }).released).toEqual([]);
  });

  it("a session the server can't type to is left alone", () => {
    const db = openDb(":memory:");
    const a = session(db, 202);
    saveSpawns(db, [a.rec]);
    const stuck = job(db, a.runId, "awaiting_confirm", 90);
    const r = sweepTabs(db, U, { now: NOW, reachable: () => false, write: () => true });
    expect(r.released).toEqual([]);
    expect((db.prepare("SELECT run_id FROM applications WHERE job_id = ?").get(stuck) as { run_id: number }).run_id).toBe(a.runId);
  });
});

describe("「点提交」 cards", () => {
  it("a refused Submit's tab counts, holds its session while fresh, and closes after an hour", () => {
    expect(SUBMIT_BLOCKED_REASON_PREFIX).toBe(SUBMIT_BLOCKED_PREFIX);
    const db = openDb(":memory:");
    seedOwner(db, U);
    const a = session(db, 303);
    saveSpawns(db, [a.rec]);
    const card = job(db, a.runId, "matched", 20);
    db.prepare("UPDATE applications SET needs_manual_reason = ?, pending_questions = ?, updated_at = ? WHERE job_id = ?").run(
      `${SUBMIT_BLOCKED_PREFIX}denied`,
      JSON.stringify([{ key: "submit", label: "S", kind: "submit" }]),
      minAgo(20),
      card
    );
    const plainMatched = job(db, a.runId, "matched", 500);
    expect(heldTabs(db, U).map((t) => t.jobId)).toEqual([card]);
    expect(attendedBusyDetail(db, U, a.rec).waiting.awaiting_confirm).toBe(1);

    // The UPDATE above re-stamped updated_at with the real clock (trigger): an hour past it.
    const r = sweepTabs(db, U, { now: Date.now() + 61 * 60_000, reachable: () => true, write: () => true });
    expect(r.released.map((x) => x.jobId)).toEqual([card]);
    expect(attendedBusyDetail(db, U, a.rec).waiting.awaiting_confirm).toBe(0);
    expect(plainMatched).toBeGreaterThan(0);
  });
});

describe("notices", () => {
  it("after submitting or a rejection the session closes the tab, keeping its group's last one", () => {
    for (const line of [approvedNotice(7, "Acme"), rejectedNotice(7, "Acme")]) {
      expect(line).toContain("close that tab with tabs_close_mcp");
      expect(line).toContain("last tab left in your group");
      expect(line).not.toContain("Do NOT close");
    }
    expect(shutdownNotice()).toContain("Close every tab in your tab group");
  });
});
