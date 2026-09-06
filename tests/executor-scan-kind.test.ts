import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";
import { startExecutor } from "@/executor/runner";
describe("scan executor kind", () => {
  it("refuses headless and enqueues a user_chrome row with options", () => {
    const db = openDb(":memory:");
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-run-"));
    expect(() => startExecutor(db, "scan", {}, { logDir }, "headless")).toThrow(/值守会话/);
    const r = startExecutor(db, "scan", { sites: ["linkedin"], window: "24h", maxPerSite: 20 }, { logDir }, "user_chrome");
    const row = db.prepare("SELECT kind, status, channel, options FROM executor_runs WHERE id = ?").get(r.id) as { kind: string; status: string; channel: string; options: string };
    expect(row).toMatchObject({ kind: "scan", status: "queued", channel: "user_chrome" });
    expect(JSON.parse(row.options)).toEqual({ sites: ["linkedin"], window: "24h", maxPerSite: 20 });
    expect(() => startExecutor(db, "scan", {}, { logDir }, "user_chrome")).toThrow(/already in progress/);
  });
});
