import fs from "fs";
import path from "path";
import type { DB } from "@/lib/db";
import { dataDir } from "@/lib/paths";
import { importProfileYaml, profileYamlPath } from "@/lib/profile";

// Accounts + tenancy helpers (spec 2026-09-13 accounts §2–§3). Better Auth owns the "user" /
// session / account / verification tables; this module is the App's own view of users plus the
// two tenancy operations every account needs: claiming the pre-accounts data bucket (the first
// account becomes the box's owner) and backfilling a per-user applications row for every job.

// Rows written before accounts existed (schema < v16) carry this user_id until an owner claims
// them. Also the schema's DEFAULT, so tests can seed rows without naming a user — application code
// must always name one (tests/tenancy-guard.test.ts).
export const LEGACY_USER_ID = "legacy";

// Every table that holds one account's data (jobs/boards/companies are shared).
export const PER_USER_TABLES = ["matches", "applications", "people", "outreach", "resumes", "experiences", "executor_runs"] as const;
export type PerUserTable = (typeof PER_USER_TABLES)[number];

export type UserRole = "owner" | "member";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  createdAt: string;
}

interface RawUser {
  id: string;
  name: string;
  email: string;
  emailVerified: number | string;
  image: string | null;
  role: string | null;
  createdAt: string | number;
}

function toUser(r: RawUser): UserRow {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: r.emailVerified === 1 || r.emailVerified === "1" || r.emailVerified === "true",
    image: r.image,
    role: r.role === "owner" ? "owner" : "member",
    createdAt: String(r.createdAt),
  };
}

const USER_COLS = 'id, name, email, emailVerified, image, role, createdAt FROM "user"';

export function getUser(db: DB, id: string): UserRow | null {
  const row = db.prepare(`SELECT ${USER_COLS} WHERE id = ?`).get(id) as RawUser | undefined;
  return row ? toUser(row) : null;
}

export function getUserByEmail(db: DB, email: string): UserRow | null {
  const row = db.prepare(`SELECT ${USER_COLS} WHERE lower(email) = lower(?)`).get(email) as RawUser | undefined;
  return row ? toUser(row) : null;
}

export function listUsers(db: DB): UserRow[] {
  return (db.prepare(`SELECT ${USER_COLS} ORDER BY createdAt ASC, id ASC`).all() as RawUser[]).map(toUser);
}

export function userCount(db: DB): number {
  return (db.prepare('SELECT COUNT(*) n FROM "user"').get() as { n: number }).n;
}

// The box's principal: the account that claimed the legacy data. The internal token acts as
// this user (src/lib/actor.ts); the dispatcher only spawns attended sessions for their runs.
export function ownerId(db: DB): string | null {
  const row = db.prepare('SELECT id FROM "user" WHERE role = ? ORDER BY createdAt ASC LIMIT 1').get("owner") as { id: string } | undefined;
  return row?.id ?? null;
}

export function setRole(db: DB, userId: string, role: UserRole): void {
  db.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(role, userId);
}

export function legacyRowCounts(db: DB): Record<PerUserTable, number> {
  const out = {} as Record<PerUserTable, number>;
  for (const t of PER_USER_TABLES) {
    out[t] = (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`).get(LEGACY_USER_ID) as { n: number }).n;
  }
  return out;
}

export function hasLegacyData(db: DB): boolean {
  return Object.values(legacyRowCounts(db)).some((n) => n > 0);
}

export interface ClaimResult {
  rows: Record<PerUserTable, number>;
  profileImported: boolean;
}

// Move everything in the legacy bucket to `userId` and import profile/profile.yaml (when present
// and the account has no profile yet). Idempotent: a second call finds nothing to move.
export function claimLegacyData(db: DB, userId: string, opts: { profileYaml?: string | null } = {}): ClaimResult {
  const rows = {} as Record<PerUserTable, number>;
  db.transaction(() => {
    for (const t of PER_USER_TABLES) {
      rows[t] = db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(userId, LEGACY_USER_ID).changes;
    }
    db.prepare("UPDATE events SET user_id = ? WHERE user_id = ?").run(userId, LEGACY_USER_ID);
  })();
  let profileImported = false;
  const yamlFile = opts.profileYaml === undefined ? profileYamlPath() : opts.profileYaml;
  const hasProfile = !!db.prepare("SELECT 1 FROM profiles WHERE user_id = ?").get(userId);
  if (!hasProfile && yamlFile && fs.existsSync(yamlFile)) {
    try {
      importProfileYaml(db, userId, fs.readFileSync(yamlFile, "utf8"));
      profileImported = true;
    } catch (e) {
      console.warn(`[users] profile.yaml at ${yamlFile} could not be imported for ${userId}: ${String(e)}`);
    }
  }
  return { rows, profileImported };
}

// One applications row per (user, job) is the invariant every queue/count query relies on
// (schema.sql). New accounts get a 'discovered' row for every job already in the library; the
// scanner adds rows for every account as jobs arrive (src/scanner/upsert.ts).
export function backfillApplications(db: DB, userId: string): number {
  return db
    .prepare("INSERT OR IGNORE INTO applications (user_id, job_id) SELECT ?, id FROM jobs")
    .run(userId).changes;
}

export interface OnUserCreatedOptions {
  // When set, only this email may claim the legacy bucket and become owner (SORTIE_OWNER_EMAIL).
  ownerEmail?: string | null;
  profileYaml?: string | null;
}
export interface OnUserCreatedResult {
  becameOwner: boolean;
  claimed: ClaimResult | null;
  backfilled: number;
}

// Better Auth's user.create.after hook lands here (src/lib/auth.ts). The first account to sign up
// (or the configured owner email) becomes owner and claims the legacy bucket; every account gets
// its applications rows.
export function onUserCreated(db: DB, user: { id: string; email: string }, opts: OnUserCreatedOptions = {}): OnUserCreatedResult {
  let becameOwner = false;
  let claimed: ClaimResult | null = null;
  const ownerEmail = opts.ownerEmail?.trim().toLowerCase() || null;
  const eligible = ownerEmail ? user.email.trim().toLowerCase() === ownerEmail : true;
  if (!ownerId(db) && eligible) {
    setRole(db, user.id, "owner");
    becameOwner = true;
    claimed = claimLegacyData(db, user.id, { profileYaml: opts.profileYaml });
  }
  const backfilled = backfillApplications(db, user.id);
  return { becameOwner, claimed, backfilled };
}

// Everything an account owns, deleted in dependency order (the auth tables cascade on their own
// when Better Auth deletes the user row). Generated resume files are left on disk on purpose —
// the user may still want them — but nothing in the db points at them any more.
export function purgeUserData(db: DB, userId: string): Record<string, number> {
  const out: Record<string, number> = {};
  db.transaction(() => {
    out.outreach_jobs = db
      .prepare("DELETE FROM outreach_jobs WHERE outreach_id IN (SELECT id FROM outreach WHERE user_id = ?)")
      .run(userId).changes;
    // applications reference people/outreach; clear those pointers before the rows go.
    db.prepare("UPDATE applications SET referral_person_id = NULL, origin_outreach_id = NULL, resume_id = NULL WHERE user_id = ?").run(userId);
    db.prepare("UPDATE matches SET resume_id = NULL WHERE user_id = ?").run(userId);
    out.outreach = db.prepare("DELETE FROM outreach WHERE user_id = ?").run(userId).changes;
    out.people = db.prepare("DELETE FROM people WHERE user_id = ?").run(userId).changes;
    out.matches = db.prepare("DELETE FROM matches WHERE user_id = ?").run(userId).changes;
    out.applications = db.prepare("DELETE FROM applications WHERE user_id = ?").run(userId).changes;
    out.resumes = db.prepare("DELETE FROM resumes WHERE user_id = ?").run(userId).changes;
    out.experiences = db.prepare("DELETE FROM experiences WHERE user_id = ?").run(userId).changes;
    out.executor_runs = db.prepare("DELETE FROM executor_runs WHERE user_id = ?").run(userId).changes;
    out.profiles = db.prepare("DELETE FROM profiles WHERE user_id = ?").run(userId).changes;
    out.api_tokens = db.prepare("DELETE FROM api_tokens WHERE user_id = ?").run(userId).changes;
    out.events = db.prepare("DELETE FROM events WHERE user_id = ?").run(userId).changes;
    db.prepare("DELETE FROM profile WHERE key LIKE ?").run(`%:${userId}`);
  })();
  return out;
}

// Per-user directories under data/ (resume PDFs, the headless browser profile). The owner keeps
// the pre-accounts locations so nothing they already set up moves.
export { dataDir };
export function userDataDir(userId: string): string {
  return path.join(dataDir(), "users", userId);
}
