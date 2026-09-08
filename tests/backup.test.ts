import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { backupFileName, selectBackupsToPrune, backupDatabase } from "@/lib/backup";

describe("backup naming and retention", () => {
  it("names backups by local day and prunes only automated ones older than keepDays", () => {
    const today = new Date(2026, 8, 20); // 2026-09-20 local time
    expect(backupFileName(today)).toBe("jobseeker-2026-09-20.db");
    const names = [
      "jobseeker-2026-09-01.db", // 19 days old → prune
      "jobseeker-2026-09-06.db", // exactly 14 days old → keep
      "jobseeker-2026-09-19.db",
      "jobseeker-2026-09-05-pre-dedup.db", // hand-made: never touched
      "notes.txt",
    ];
    expect(selectBackupsToPrune(names, today, 14)).toEqual(["jobseeker-2026-09-01.db"]);
  });
});

describe("backupDatabase", () => {
  it("writes a consistent copy of a live database and prunes old automated backups", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-"));
    const src = path.join(dir, "jobseeker.db");
    const live = openDb(src); // stays open: simulates the running server
    live.prepare("INSERT INTO profile (key, value) VALUES ('k', 'v')").run();
    const outDir = path.join(dir, "backups");
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, "jobseeker-2020-01-01.db"), "");
    fs.writeFileSync(path.join(outDir, "jobseeker-2020-01-01-manual.db"), "");

    const r = await backupDatabase({ src, outDir, today: new Date(2026, 8, 20), keepDays: 14 });

    expect(r.dest).toBe(path.join(outDir, "jobseeker-2026-09-20.db"));
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.pruned).toEqual(["jobseeker-2020-01-01.db"]);
    expect(fs.existsSync(path.join(outDir, "jobseeker-2020-01-01.db"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "jobseeker-2020-01-01-manual.db"))).toBe(true);

    const copy = new Database(r.dest, { readonly: true });
    expect(copy.prepare("SELECT value FROM profile WHERE key = 'k'").get()).toEqual({ value: "v" });
    copy.close();
    live.close();
  });
});
