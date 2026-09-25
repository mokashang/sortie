import { describe, it, expect, vi } from "vitest";
import { openDb, DB } from "@/lib/db";
import { decideAndMaybeAutoStart, requeueStrandedApprovals, isBareResumeRun } from "@/apply/decide-auto-start";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

function seedAwaitingConfirm(db: DB): number {
  const jobId = db
    .prepare(
      "INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(`fp-${Math.random()}`, "Acme", "SWE", "https://acme.example/apply", "greenhouse", "manual", "2026-01-01 00:00:00")
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "ai_infra", 80, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, "awaiting_confirm");
  return jobId;
}

describe("decideAndMaybeAutoStart", () => {
  it("approve with no prior apply run at all auto-starts on the default user_chrome channel", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => null);
    const startExecutor = vi.fn(() => ({ id: 42, pid: null, logPath: "/tmp/run-42.log" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: true, runId: 42, channel: "user_chrome" });
    expect(hasLiveOrQueuedRun).toHaveBeenCalledWith(db, U, "apply");
    expect(lastRunChannel).toHaveBeenCalledWith(db, U, "apply");
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "user_chrome");

    const row = db.prepare("SELECT confirm_decision FROM applications WHERE job_id=?").get(jobId) as {
      confirm_decision: string;
    };
    expect(row.confirm_decision).toBe("approved");
  });

  it("approve follows the last apply run's channel when it was user_chrome", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => "user_chrome" as const);
    const startExecutor = vi.fn(() => ({ id: 7, pid: null, logPath: "/tmp/run-7.log" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: true, runId: 7, channel: "user_chrome" });
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "user_chrome");
  });

  it("approve follows the last apply run's channel when it was headless", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => "headless" as const);
    const startExecutor = vi.fn(() => ({ id: 8, pid: 123, logPath: "/tmp/run-8.log" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: true, runId: 8, channel: "headless" });
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "headless");
  });

  it("approve with a live or queued executor already does not auto-start", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => true);
    const lastRunChannel = vi.fn(() => "user_chrome" as const);
    const startExecutor = vi.fn(() => ({ id: 1, pid: 1, logPath: "" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("reject never checks liveness or auto-starts", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const startExecutor = vi.fn(() => ({ id: 1, pid: 1, logPath: "" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "reject", "not a fit", { hasLiveOrQueuedRun, startExecutor });

    expect(result).toEqual({ autoStarted: false });
    expect(hasLiveOrQueuedRun).not.toHaveBeenCalled();
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("a start/enqueue failure never breaks the approve itself", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => null);
    const startExecutor = vi.fn(() => {
      throw new Error("spawn ENOENT");
    });

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: false });
    // The approve itself still went through despite the failure.
    const row = db.prepare("SELECT confirm_decision FROM applications WHERE job_id=?").get(jobId) as {
      confirm_decision: string;
    };
    expect(row.confirm_decision).toBe("approved");
  });

  it("an invalid decision still throws (decide()'s own validation is not swallowed)", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    expect(() =>
      // @ts-expect-error deliberately invalid decision value for the test
      decideAndMaybeAutoStart(db, U, jobId, "bogus", undefined, {})
    ).toThrow();
  });
});

function seedApplyRun(db: DB, status: string, options: object, channel = "user_chrome"): number {
  return db
    .prepare("INSERT INTO executor_runs (user_id, kind, status, channel, options) VALUES (?, 'apply', ?, ?, ?)")
    .run(U, status, channel, JSON.stringify(options)).lastInsertRowid as number;
}

function approve(db: DB, jobId: number): void {
  db.prepare("UPDATE applications SET confirm_decision = 'approved' WHERE job_id = ?").run(jobId);
}

describe("isBareResumeRun", () => {
  it("is only the resume-only shape the approve path queues", () => {
    expect(isBareResumeRun({ resume: true })).toBe(true);
    expect(isBareResumeRun({ resume: true, plan: [], jobIds: [] })).toBe(true);
    expect(isBareResumeRun({ resume: true, plan: [{ direction: "swe_general", count: 3, mode: "direct" }] })).toBe(false);
    expect(isBareResumeRun({ resume: true, jobIds: [1] })).toBe(false);
    expect(isBareResumeRun({ jobIds: [1], mode: "direct" })).toBe(false);
    expect(isBareResumeRun({})).toBe(false);
    expect(isBareResumeRun(null)).toBe(false);
  });
});

// The finish route and the dispatcher tick call this after a run ended: an approval that landed
// while the run was still marked running was left to that session (decide's auto-start stands
// down for a live run), and if the session ended without acting on it nobody would ever submit it.
describe("requeueStrandedApprovals", () => {
  const start = () => vi.fn(() => ({ id: 99, pid: null, logPath: "/tmp/run-99.log" }));
  const userChrome = () => "user_chrome" as const;

  it("queues a resume run when an approval was left behind by a run that ended", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    approve(db, jobId);
    // Run #71's shape (2026-09-14): a targeted run that finished ten seconds after the click.
    seedApplyRun(db, "done", { jobIds: [jobId], mode: "direct" });
    const startExecutor = start();

    const result = requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor });

    expect(result).toEqual({ autoStarted: true, runId: 99, channel: "user_chrome" });
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "user_chrome");
  });

  it("also covers a plan run that was reaped as failed (session gone)", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    approve(db, jobId);
    seedApplyRun(db, "failed", { plan: [{ direction: "swe_general", count: 30, mode: "direct" }], chunk: 10 });
    const startExecutor = start();

    const result = requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor });

    expect(result.autoStarted).toBe(true);
    expect(startExecutor).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no approval is waiting", () => {
    const db = openDb(":memory:");
    seedAwaitingConfirm(db); // filled, not decided yet
    seedApplyRun(db, "done", { jobIds: [1], mode: "direct" });
    const startExecutor = start();

    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: () => null, startExecutor })).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("leaves the approval to a run that is live or queued", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    approve(db, jobId);
    seedApplyRun(db, "running", { jobIds: [jobId], mode: "direct" });
    const startExecutor = start();

    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => true, lastRunChannel: userChrome, startExecutor })).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("never re-queues after a bare resume run: one retry per real run, no spawn loop", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    approve(db, jobId);
    seedApplyRun(db, "done", { jobIds: [jobId], mode: "direct" });
    seedApplyRun(db, "failed", { resume: true });
    const startExecutor = start();

    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor })).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("does not restart a run the user stopped", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    approve(db, jobId);
    seedApplyRun(db, "stopped", { plan: [{ direction: "swe_general", count: 5, mode: "direct" }] });
    const startExecutor = start();

    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor })).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("a start failure is swallowed", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    approve(db, jobId);
    seedApplyRun(db, "done", { jobIds: [jobId], mode: "direct" });

    const result = requeueStrandedApprovals(db, U, {
      hasLiveOrQueuedRun: () => false,
      lastRunChannel: userChrome,
      startExecutor: () => {
        throw new Error("spawn ENOENT");
      },
    });
    expect(result).toEqual({ autoStarted: false });
  });
});

// 2026-09-24: seven approved referral messages sat at pending_send for two days — the check
// above only counted applications, and a bare resume run that hit the per-run invite cap left
// the rest for a "next task" nothing queued.
describe("requeueStrandedApprovals with approved referral messages", () => {
  const start = () => vi.fn(() => ({ id: 77, pid: null, logPath: "/tmp/run-77.log" }));
  const userChrome = () => "user_chrome" as const;

  function seedOutreach(db: DB, status: string, threadLog: object[] = []): number {
    const jobId = seedAwaitingConfirm(db);
    db.prepare("UPDATE applications SET status = 'referral_seeking' WHERE job_id = ?").run(jobId);
    const pid = db.prepare("INSERT INTO people (name) VALUES ('P')").run().lastInsertRowid as number;
    return db
      .prepare("INSERT INTO outreach (person_id, job_id, playbook, channel, draft, status, thread_log) VALUES (?, ?, 'referral', 'linkedin', 'hi', ?, ?)")
      .run(pid, jobId, status, JSON.stringify(threadLog)).lastInsertRowid as number;
  }

  function seedRunAt(db: DB, status: string, options: object, startedAt: string, endedAt: string): void {
    db.prepare("INSERT INTO executor_runs (user_id, kind, status, channel, options, started_at, ended_at) VALUES (?, 'apply', ?, 'user_chrome', ?, ?, ?)").run(
      U,
      status,
      JSON.stringify(options),
      startedAt,
      endedAt
    );
  }

  it("queues a resume run for a message approved while a targeted run was on", () => {
    const db = openDb(":memory:");
    seedOutreach(db, "pending_send");
    seedApplyRun(db, "done", { jobIds: [1], mode: "direct" });
    const startExecutor = start();

    const result = requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor, attendedReachable: () => true });

    expect(result).toEqual({ autoStarted: true, runId: 77, channel: "user_chrome" });
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "user_chrome");
  });

  it("keeps going after a bare resume run that sent some and hit the per-run cap", () => {
    const db = openDb(":memory:");
    seedOutreach(db, "sent", [{ at: "2026-09-23T01:30:00.000Z", dir: "sent", text: "hi" }]);
    seedOutreach(db, "pending_send");
    seedRunAt(db, "done", { resume: true }, "2026-09-23 01:26:00", "2026-09-23 01:41:08");
    const startExecutor = start();

    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor }).autoStarted).toBe(true);
  });

  it("stops after a bare resume run that sent nothing", () => {
    const db = openDb(":memory:");
    seedOutreach(db, "sent", [{ at: "2026-09-20T01:30:00.000Z", dir: "sent", text: "hi" }]); // before the run
    seedOutreach(db, "pending_send");
    seedRunAt(db, "done", { resume: true }, "2026-09-23 01:26:00", "2026-09-23 01:41:08");
    const startExecutor = start();

    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor })).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("ignores drafts, coffee-chat messages and runs the user stopped", () => {
    const db = openDb(":memory:");
    seedOutreach(db, "draft");
    const pid = db.prepare("INSERT INTO people (name) VALUES ('Q')").run().lastInsertRowid as number;
    db.prepare("INSERT INTO outreach (person_id, playbook, channel, draft, status) VALUES (?, 'coffee_chat', 'linkedin', 'hi', 'pending_send')").run(pid);
    seedApplyRun(db, "done", { jobIds: [1], mode: "direct" });
    const startExecutor = start();
    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor })).toEqual({ autoStarted: false });

    seedOutreach(db, "pending_send");
    seedApplyRun(db, "stopped", { plan: [{ direction: "swe_general", count: 5, mode: "referral" }] });
    expect(requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: userChrome, startExecutor })).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });
});

// 2026-09-17: the session that filled a form stays alive at its prompt with the tab open, and
// the App types approvals/rejections straight into its terminal. Queueing a run is now only the
// fallback for when no such session is reachable.
describe("decideAndMaybeAutoStart with a live attended session", () => {
  it("approve tells the session and queues nothing", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    const typed: string[] = [];
    const startExecutor = vi.fn(() => ({ id: 1, pid: null, logPath: "" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun: () => false,
      lastRunChannel: () => "user_chrome" as const,
      startExecutor,
      notifyAttended: (line) => {
        typed.push(line);
        return true;
      },
    });

    expect(result).toEqual({ autoStarted: false, notified: true });
    expect(typed[0]).toContain("[Sortie] approved job " + jobId + " (Acme)");
    expect(startExecutor).not.toHaveBeenCalled();
    const row = db.prepare("SELECT confirm_decision FROM applications WHERE job_id=?").get(jobId) as { confirm_decision: string };
    expect(row.confirm_decision).toBe("approved");
  });

  it("reject tells the session to close the tab", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    const typed: string[] = [];
    const result = decideAndMaybeAutoStart(db, U, jobId, "reject", "wrong degree", {
      hasLiveOrQueuedRun: () => false,
      notifyAttended: (line) => {
        typed.push(line);
        return true;
      },
    });
    expect(result).toEqual({ autoStarted: false, notified: true });
    expect(typed[0]).toContain(`rejected job ${jobId}`);
  });

  it("falls back to queueing a resume run when no session can be reached", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    const startExecutor = vi.fn(() => ({ id: 42, pid: null, logPath: "/tmp/run-42.log" }));
    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun: () => false,
      lastRunChannel: () => null,
      startExecutor,
      notifyAttended: () => false,
    });
    expect(result).toEqual({ autoStarted: true, runId: 42, channel: "user_chrome" });
  });

  it("requeueStrandedApprovals stands down while a reachable session holds the tabs", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);
    approve(db, jobId);
    seedApplyRun(db, "done", { jobIds: [jobId], mode: "direct" });
    const startExecutor = vi.fn(() => ({ id: 99, pid: null, logPath: "" }));
    expect(
      requeueStrandedApprovals(db, U, { hasLiveOrQueuedRun: () => false, lastRunChannel: () => "user_chrome" as const, startExecutor, attendedReachable: () => true })
    ).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });
});
