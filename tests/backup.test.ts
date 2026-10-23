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

import { mirrorBackup } from "@/lib/backup";
describe("mirrorBackup", () => {
  it("copies the newest backup to the mirror and prunes old mirrored days only", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-bk-src-"));
    const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-bk-mirror-"));
    const today = new Date(2026, 9, 22);
    const file = path.join(src, backupFileName(today));
    fs.writeFileSync(file, "db");
    for (const n of ["jobseeker-2026-10-01.db", "jobseeker-2026-10-21.db", "jobseeker-pre-migration.db"]) fs.writeFileSync(path.join(mirror, n), "old");
    const r = mirrorBackup(file, mirror, { today, keepDays: 3 });
    expect(r.error).toBeUndefined();
    expect(r.pruned).toEqual(["jobseeker-2026-10-01.db"]);
    expect(fs.readdirSync(mirror).sort()).toEqual(["jobseeker-2026-10-21.db", "jobseeker-2026-10-22.db", "jobseeker-pre-migration.db"]);
    expect(fs.readFileSync(path.join(mirror, "jobseeker-2026-10-22.db"), "utf8")).toBe("db");
  });
  it("reports instead of throwing when the mirror disk is unusable", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-bk-src-"));
    const file = path.join(src, "jobseeker-2026-10-22.db");
    fs.writeFileSync(file, "db");
    const blocker = path.join(src, "not-a-dir");
    fs.writeFileSync(blocker, "x");
    const r = mirrorBackup(file, path.join(blocker, "mirror"));
    expect(r.dest).toBeNull();
    expect(r.error).toBeTruthy();
  });
});
