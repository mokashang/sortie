import { describe, it, expect, beforeEach } from "vitest";
import {
  registerAttendedHandle,
  unregisterAttendedHandle,
  isAttendedReachable,
  writeToAttended,
  resetAttendedRegistry,
  approvedNotice,
  rejectedNotice,
  queuedRunNotice,
  stoppedRunNotice,
  noticeDue,
  markNotice,
  clearNotices,
  NOTICE_PREFIX,
  ENTER_DELAY_MS,
} from "@/executor/attended-session";

// The App talks to the long-lived attended session by typing into the terminal the dispatcher
// spawned it under (attended-win.ts registers the pty here). These tests use a fake terminal.
describe("attended session terminal registry", () => {
  beforeEach(() => resetAttendedRegistry());

  it("types the line, then presses Enter a moment later, into a registered terminal", () => {
    const typed: string[] = [];
    const deferred: { fn: () => void; ms: number }[] = [];
    registerAttendedHandle({ pid: 42, write: (d) => typed.push(d) });

    expect(isAttendedReachable(42)).toBe(true);
    expect(writeToAttended(42, "[Sortie] approved job 7", { defer: (fn, ms) => deferred.push({ fn, ms }) })).toBe(true);
    expect(typed).toEqual(["[Sortie] approved job 7"]);
    expect(deferred).toHaveLength(1);
    expect(deferred[0].ms).toBe(ENTER_DELAY_MS);
    deferred[0].fn();
    expect(typed).toEqual(["[Sortie] approved job 7", "\r"]);
  });

  it("flattens newlines so one notice is one prompt line", () => {
    const typed: string[] = [];
    registerAttendedHandle({ pid: 1, write: (d) => typed.push(d) });
    writeToAttended(1, "first\nsecond\r\n", { defer: () => {} });
    expect(typed).toEqual(["first second"]);
  });

  it("is unreachable for a pid nobody registered here, or after it exited", () => {
    expect(isAttendedReachable(9)).toBe(false);
    expect(writeToAttended(9, "hello", { defer: () => {} })).toBe(false);
    registerAttendedHandle({ pid: 9, write: () => {} });
    unregisterAttendedHandle(9);
    expect(isAttendedReachable(9)).toBe(false);
  });

  it("reports false when the terminal throws (child gone between the two writes)", () => {
    registerAttendedHandle({
      pid: 3,
      write: () => {
        throw new Error("EPIPE");
      },
    });
    expect(writeToAttended(3, "x", { defer: () => {} })).toBe(false);
  });

  it("notices are single ASCII lines that start with the App's prefix", () => {
    for (const line of [approvedNotice(283159, "ID.me"), rejectedNotice(414860, "Lumion 露米"), queuedRunNotice(77, "apply"), stoppedRunNotice(77)]) {
      expect(line.startsWith(NOTICE_PREFIX)).toBe(true);
      expect(line).not.toMatch(/[^\x20-\x7e]/);
      expect(line).not.toContain("\n");
    }
    expect(approvedNotice(283159, "ID.me")).toContain("approved job 283159 (ID.me)");
    expect(approvedNotice(283159, "ID.me")).toContain("status:'submitted'");
    expect(rejectedNotice(414860, "Lumion 露米")).toContain("rejected job 414860 (Lumion)");
    expect(queuedRunNotice(77, "apply")).toContain("run 77 queued (apply)");
    expect(queuedRunNotice(77, "apply")).toContain("claim-next");
  });

  it("throttles queued-run reminders", () => {
    expect(noticeDue("run:7", 1_000, 120_000)).toBe(true);
    markNotice("run:7", 1_000);
    expect(noticeDue("run:7", 60_000, 120_000)).toBe(false);
    expect(noticeDue("run:7", 121_000, 120_000)).toBe(true);
    clearNotices();
    expect(noticeDue("run:7", 2_000, 120_000)).toBe(true);
  });
});
