import { describe, it, expect } from "vitest";
import os from "os";
import { openDb, DB } from "@/lib/db";
import { attendedAvailable, applyChannelFor, handOffUnservableRuns, MEMBER_UNSERVABLE_SUMMARY, MEMBER_NO_RESUME_SUMMARY } from "@/executor/channel";
import { recordHeartbeat } from "@/executor/attended";
import type { startExecutor } from "@/executor/runner";
import { seedOwner, seedUser } from "./helpers";

const OWNER = "owner-1";
const MEMBER = "member-1";

function box(opts: { resume?: boolean } = { resume: true }): DB {
  const db = openDb(":memory:");
  seedOwner(db, OWNER, "owner@example.com");
  seedUser(db, MEMBER, "brother@example.com", { role: "member" });
  if (opts.resume)
    db.prepare("INSERT INTO resumes (user_id, version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?,?)").run(
      MEMBER,
      "all",
      JSON.stringify(["embedded", "swe_general"]),
      "users/member-1/resumes/all.pdf",
      "2026-10-01 00:00:00"
    );
  return db;
}

function queueChrome(db: DB, userId: string, kind: string, options: object): number {
  return Number(
    db.prepare("INSERT INTO executor_runs (user_id, kind, status, channel, options) VALUES (?, ?, 'queued', 'user_chrome', ?)").run(userId, kind, JSON.stringify(options))
      .lastInsertRowid
  );
}

// A fake startExecutor that records the call and inserts a running headless row like the real one.
function fakeStart(calls: { userId: string; options: object; channel: string }[]): typeof startExecutor {
  return ((db: DB, userId: string, kind: string, options: object, _deps: object, channel: string) => {
    calls.push({ userId, options, channel });
    const id = Number(
      db.prepare("INSERT INTO executor_runs (user_id, kind, status, channel, pid, options) VALUES (?, ?, 'running', ?, ?, ?)").run(userId, kind, channel, process.pid, JSON.stringify(options))
        .lastInsertRowid
    );
    return { id, pid: process.pid, logPath: `${os.tmpdir()}/run-${id}.log` };
  }) as unknown as typeof startExecutor;
}

describe("which channel an account can be served on", () => {
  it("the owner always gets Chrome; another account only while its own assistant heartbeats", () => {
    const db = box();
    expect(attendedAvailable(db, OWNER)).toBe(true);
    expect(attendedAvailable(db, MEMBER)).toBe(false);
    recordHeartbeat(db, MEMBER, "desktop-1", "desktop");
    expect(attendedAvailable(db, MEMBER)).toBe(true);
    expect(attendedAvailable(db, MEMBER, new Date(Date.now() + 120_000))).toBe(false);
  });

  it("a box with no accounts yet counts as the owner's", () => {
    expect(attendedAvailable(openDb(":memory:"), "legacy")).toBe(true);
  });

  it("App-started work goes to the background browser for a member, and follows the last channel for the owner", () => {
    const db = box();
    expect(applyChannelFor(db, MEMBER)).toBe("headless");
    expect(applyChannelFor(db, OWNER)).toBe("user_chrome");
    expect(applyChannelFor(db, OWNER, () => "headless")).toBe("headless");
  });
});

describe("handOffUnservableRuns", () => {
  it("moves a member's queued Chrome apply task to the background browser with the same plan", () => {
    const db = box();
    const plan = { plan: [{ direction: "embedded", count: 12, mode: "direct" }], chunk: 10 };
    const old = queueChrome(db, MEMBER, "apply", plan);
    const calls: { userId: string; options: object; channel: string }[] = [];
    const r = handOffUnservableRuns(db, { startExecutor: fakeStart(calls) });
    expect(calls).toEqual([{ userId: MEMBER, options: plan, channel: "headless" }]);
    expect(r.moved).toEqual([{ from: old, to: expect.any(Number), userId: MEMBER }]);
    const row = db.prepare("SELECT status, summary FROM executor_runs WHERE id = ?").get(old) as { status: string; summary: string };
    expect(row.status).toBe("stopped");
    expect(row.summary).toContain(`#${r.moved[0].to}`);
  });

  it("moves one per account at a time, and leaves the owner's queue and a member with an assistant online alone", () => {
    const db = box();
    queueChrome(db, OWNER, "apply", { plan: [{ direction: "swe_general", count: 3 }] });
    const first = queueChrome(db, MEMBER, "apply", { jobIds: [1], mode: "direct" });
    const second = queueChrome(db, MEMBER, "apply", { jobIds: [2], mode: "direct" });
    const calls: { userId: string; options: object; channel: string }[] = [];
    const r = handOffUnservableRuns(db, { startExecutor: fakeStart(calls) });
    expect(r.moved.map((m) => m.from)).toEqual([first]);
    expect((db.prepare("SELECT status FROM executor_runs WHERE id = ?").get(second) as { status: string }).status).toBe("queued");
    // the moved run is now a live headless process, so the second waits for the next tick
    expect(handOffUnservableRuns(db, { startExecutor: fakeStart(calls) }).moved).toEqual([]);

    const db2 = box();
    recordHeartbeat(db2, MEMBER, "desktop-1", "desktop");
    queueChrome(db2, MEMBER, "apply", { jobIds: [3], mode: "direct" });
    expect(handOffUnservableRuns(db2, { startExecutor: fakeStart([]) })).toEqual({ moved: [], closed: [] });
  });

  it("closes a member's plan no resume can go with, saying to upload one, instead of running it dry", () => {
    const db = box({ resume: false });
    const old = queueChrome(db, MEMBER, "apply", { plan: [{ direction: "embedded", count: 12, mode: "direct" }] });
    const r = handOffUnservableRuns(db, { startExecutor: fakeStart([]) });
    expect(r).toEqual({ moved: [], closed: [old] });
    expect((db.prepare("SELECT status, summary FROM executor_runs WHERE id = ?").get(old) as { summary: string }).summary).toBe(MEMBER_NO_RESUME_SUMMARY);
  });

  it("closes a member's Chrome-only task (referral, scan) with the reason instead of leaving it queued", () => {
    const db = box();
    const referral = queueChrome(db, MEMBER, "apply", { plan: [{ direction: "embedded", count: 2, mode: "referral" }] });
    const scan = queueChrome(db, MEMBER, "scan", {});
    const r = handOffUnservableRuns(db, { startExecutor: fakeStart([]) });
    expect(r.closed).toEqual([referral, scan]);
    const rows = db.prepare("SELECT status, summary FROM executor_runs WHERE id IN (?, ?)").all(referral, scan) as { status: string; summary: string }[];
    expect(rows.every((x) => x.status === "failed" && x.summary === MEMBER_UNSERVABLE_SUMMARY)).toBe(true);
  });
});
