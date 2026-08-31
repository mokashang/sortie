import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { syncWatchlist, getEnabledCompanies, setProbeStatus } from "@/scanner/watchlist";

const seed = [
  { name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: ["swe_general"] },
  { name: "NoApi", tier: 2, ats: "other", board_token: null, careers_url: "https://x.example", directions: ["quant"] },
];

describe("watchlist", () => {
  it("syncs seed into companies table, idempotently", () => {
    const db = openDb(":memory:");
    syncWatchlist(db, seed);
    syncWatchlist(db, seed); // 再跑一遍不重复
    const rows = db.prepare("SELECT COUNT(*) as n FROM companies").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("returns only enabled companies that have a pollable ats", () => {
    const db = openDb(":memory:");
    syncWatchlist(db, seed);
    const pollable = getEnabledCompanies(db, { pollableOnly: true });
    expect(pollable).toHaveLength(1);
    expect(pollable[0].name).toBe("Acme");
  });

  it("reseeding updates mutable fields (e.g. board_token) but preserves enabled/probe_status", () => {
    const db = openDb(":memory:");
    syncWatchlist(db, seed);
    // simulate user/scan mutations that must survive a reseed
    const row = db.prepare("SELECT id FROM companies WHERE name='Acme'").get() as { id: number };
    setProbeStatus(db, row.id, "ok");
    db.prepare("UPDATE companies SET enabled=0 WHERE id=?").run(row.id);

    const updatedSeed = [
      { name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme2", directions: ["swe_general", "mle"] },
      { name: "NoApi", tier: 2, ats: "other", board_token: null, careers_url: "https://x.example", directions: ["quant"] },
    ];
    syncWatchlist(db, updatedSeed);

    const after = db
      .prepare("SELECT board_token, directions, enabled, probe_status FROM companies WHERE name='Acme'")
      .get() as { board_token: string; directions: string; enabled: number; probe_status: string };
    expect(after.board_token).toBe("acme2");
    expect(JSON.parse(after.directions)).toEqual(["swe_general", "mle"]);
    expect(after.enabled).toBe(0);
    expect(after.probe_status).toBe("ok");
  });
});
