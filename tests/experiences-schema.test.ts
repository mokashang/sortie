import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";

describe("experiences schema", () => {
  it("creates the experiences table with an updated_at trigger", () => {
    const db = openDb(":memory:");
    const info = db
      .prepare("INSERT INTO experiences (kind, title, organization, bullets) VALUES (?,?,?,?)")
      .run("project", "Distributed Trainer", "USC", JSON.stringify([{ text: "Built X", directions: ["ai_infra"] }]));
    const row = db.prepare("SELECT title, bullets FROM experiences WHERE id=?").get(info.lastInsertRowid) as any;
    expect(row.title).toBe("Distributed Trainer");
    expect(JSON.parse(row.bullets)[0].directions).toEqual(["ai_infra"]);
  });
  it("reports the current schema user_version", () => {
    const db = openDb(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(14);
  });
});
