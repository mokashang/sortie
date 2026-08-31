import { DB } from "@/lib/db";

export interface SeedCompany {
  name: string;
  tier: number;
  ats: string;
  board_token: string | null;
  careers_url?: string;
  directions: string[];
}

export interface CompanyRow {
  id: number;
  name: string;
  tier: number;
  ats: string | null;
  board_token: string | null;
  careers_url: string | null;
  enabled: number;
  probe_status: string | null;
}

const POLLABLE = new Set(["greenhouse", "lever", "ashby"]);

export function syncWatchlist(db: DB, seed: SeedCompany[]): void {
  const ins = db.prepare(
    `INSERT INTO companies (name, tier, ats, board_token, careers_url, probe_status, directions)
     VALUES (?,?,?,?,?, 'untested', ?)
     ON CONFLICT(name) DO NOTHING`
  );
  const tx = db.transaction((rows: SeedCompany[]) => {
    for (const c of rows)
      ins.run(c.name, c.tier, c.ats, c.board_token, c.careers_url ?? null, JSON.stringify(c.directions));
  });
  tx(seed);
}

export function getEnabledCompanies(db: DB, opts: { pollableOnly?: boolean } = {}): CompanyRow[] {
  const rows = db.prepare("SELECT * FROM companies WHERE enabled=1").all() as CompanyRow[];
  return opts.pollableOnly
    ? rows.filter((r) => r.ats !== null && POLLABLE.has(r.ats) && r.board_token)
    : rows;
}

export function setProbeStatus(db: DB, companyId: number, status: "ok" | "failed"): void {
  db.prepare("UPDATE companies SET probe_status=? WHERE id=?").run(status, companyId);
}
