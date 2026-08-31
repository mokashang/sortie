import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { syncWatchlist, getEnabledCompanies } from "@/scanner/watchlist";

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
});
