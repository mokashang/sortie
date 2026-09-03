import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { startExecutor, appendRunLog, finishRun, runLogLines } from "@/executor/runner";

describe("runLogLines (full run log for the App's 详情 view)", () => {
  let db: DB;
  let tmpLogDir: string;
  beforeEach(() => {
    db = openDb(":memory:");
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-executor-log-"));
  });
  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  it("returns every line of the run's log, in order, for running and finished runs alike", () => {
    const run = startExecutor(db, "apply", { plan: [{ direction: "swe_general", count: 1 }] }, { logDir: tmpLogDir }, "user_chrome");
    expect(runLogLines(db, run.id)).toEqual([]);
    for (let i = 1; i <= 40; i++) appendRunLog(db, run.id, `step ${i}`);
    const lines = runLogLines(db, run.id);
    expect(lines).toHaveLength(40);
    expect(lines[0]).toMatch(/\] step 1$/);
    expect(lines[39]).toMatch(/\] step 40$/);

    finishRun(db, run.id, "done", "ok");
    expect(runLogLines(db, run.id)).toHaveLength(40);
  });

  it("throws for an unknown run and returns [] when the log file is gone", () => {
    expect(() => runLogLines(db, 999)).toThrow();
    const run = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
    fs.rmSync(run.logPath);
    expect(runLogLines(db, run.id)).toEqual([]);
  });
});
