import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Static guard for the tenancy rule (spec 2026-09-13 accounts §3): every INSERT into a per-user
// table in application code must name user_id explicitly. The column's DEFAULT ('legacy') exists
// for migration and test seeding only — a forgotten user_id in src/ would silently file a row
// under the unclaimed bucket, invisible to every account.
const PER_USER = ["matches", "applications", "people", "outreach", "resumes", "experiences", "executor_runs", "profiles", "api_tokens"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// Every string literal (template or double-quoted) in a source file.
function stringLiterals(text: string): string[] {
  return [...text.matchAll(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"/g)].map((m) => m[0]);
}

describe("tenancy guard", () => {
  it("every INSERT into a per-user table under src/ names user_id", () => {
    const root = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, "utf8");
      const re = new RegExp(`INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO\\s+(${PER_USER.join("|")})\\s*\\(([^)]*)\\)`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!/\buser_id\b/.test(m[2])) offenders.push(`${path.relative(process.cwd(), file)}: INSERT INTO ${m[1]} (${m[2].trim().slice(0, 60)})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("SQL literals that read or write applications/matches/people/outreach in the tenant modules carry user_id", () => {
    // Coarser than the INSERT rule (joins may carry the predicate through a.user_id), so this is
    // a smoke check on the modules where a missing filter would leak another account's rows.
    // Lookups by a row's own primary key (id = ?) are fine: the id came from a scoped query.
    const files = ["src/apply/queue.ts", "src/apply/referral.ts", "src/apply/history.ts", "src/apply/info.ts", "src/apply/mode.ts", "src/network/gate.ts", "src/network/crm.ts", "src/network/stats.ts", "src/matcher/referral-fit.ts"];
    const SAFE = [/WHERE id = \?/, /WHERE outreach_id = \?/, /WHERE o\.person_id = p\.id AND o\.playbook/, /SET status = \? WHERE id = \?/, /SET thread_log = \? WHERE id = \?/];
    for (const f of files) {
      const text = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      const leaky = stringLiterals(text).filter(
        (s) => /\b(FROM|UPDATE|JOIN)\s+(applications|matches|people|outreach)\b/.test(s) && !/user_id/.test(s) && !SAFE.some((re) => re.test(s))
      );
      expect(leaky, f).toEqual([]);
    }
  });
});
