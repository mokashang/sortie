import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import {
  LEGACY_USER_ID,
  backfillApplications,
  claimLegacyData,
  getUser,
  getUserByEmail,
  hasLegacyData,
  listUsers,
  onUserCreated,
  ownerId,
  purgeUserData,
} from "@/lib/users";
import { getProfileData, loadProfile, profileStatus, saveProfile, saveStandardAnswers, tryLoadProfile, importProfileYaml, ProfileIncompleteError } from "@/lib/profile";
import { seedUser } from "./helpers";

function seedJob(db: DB, company = "Acme"): number {
  return db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)").run(`fp-${Math.random()}`, company, "SWE", "manual")
    .lastInsertRowid as number;
}

const yaml = `
name: Mengjia Shang
email: shangmengjiajiajia@gmail.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/mengjia-shang
github: github.com/mokashang
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1
  needs_sponsorship: true
targets:
  primary: newgrad
directions:
  swe_general: 1
standard_answers:
  city: "Los Angeles, CA"
`;

describe("users", () => {
  it("reads users back with role and emailVerified normalized", () => {
    const db = openDb(":memory:");
    seedUser(db, "u1", "A@Example.com", { name: "Ann" });
    expect(getUser(db, "u1")).toMatchObject({ id: "u1", name: "Ann", email: "A@Example.com", emailVerified: false, role: "member" });
    expect(getUserByEmail(db, "a@example.com")?.id).toBe("u1");
    expect(listUsers(db).map((u) => u.id)).toEqual(["u1"]);
    expect(ownerId(db)).toBeNull();
  });

  it("the first account becomes owner, claims the legacy bucket and imports profile.yaml; the second gets a clean slate with backfilled rows", () => {
    const db = openDb(":memory:");
    const j1 = seedJob(db);
    const j2 = seedJob(db);
    db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'matched')").run(j1);
    db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'discovered')").run(j2);
    db.prepare("INSERT INTO matches (job_id, score) VALUES (?, 80)").run(j1);
    db.prepare("INSERT INTO people (name) VALUES ('Pat')").run();
    db.prepare("INSERT INTO experiences (kind, title) VALUES ('work', 'Intern')").run();
    db.prepare("INSERT INTO executor_runs (kind, status) VALUES ('apply', 'done')").run();
    db.prepare("INSERT INTO events (user_id, kind) VALUES ('legacy', 'application_stage')").run();
    expect(hasLegacyData(db)).toBe(true);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "users-"));
    const yamlFile = path.join(dir, "profile.yaml");
    fs.writeFileSync(yamlFile, yaml);

    seedUser(db, "owner1", "shangmengjiajiajia@gmail.com");
    const r1 = onUserCreated(db, { id: "owner1", email: "shangmengjiajiajia@gmail.com" }, { profileYaml: yamlFile });
    expect(r1.becameOwner).toBe(true);
    expect(r1.claimed?.rows).toMatchObject({ applications: 2, matches: 1, people: 1, experiences: 1, executor_runs: 1 });
    expect(r1.claimed?.profileImported).toBe(true);
    expect(r1.backfilled).toBe(0); // every job already had a (claimed) row
    expect(ownerId(db)).toBe("owner1");
    expect(hasLegacyData(db)).toBe(false);
    expect((db.prepare("SELECT user_id FROM events").get() as { user_id: string }).user_id).toBe("owner1");
    expect(loadProfile(db, "owner1").standard_answers).toEqual({ city: "Los Angeles, CA" });

    seedUser(db, "u2", "second@example.com");
    const r2 = onUserCreated(db, { id: "u2", email: "second@example.com" }, { profileYaml: yamlFile });
    expect(r2.becameOwner).toBe(false);
    expect(r2.claimed).toBeNull();
    expect(r2.backfilled).toBe(2);
    expect(db.prepare("SELECT status FROM applications WHERE user_id = 'u2' ORDER BY job_id").all()).toEqual([{ status: "discovered" }, { status: "discovered" }]);
    expect(tryLoadProfile(db, "u2")).toBeNull();
    // Backfill is idempotent.
    expect(backfillApplications(db, "u2")).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("SORTIE_OWNER_EMAIL restricts who may become owner; a later matching sign-up still claims", () => {
    const db = openDb(":memory:");
    const j = seedJob(db);
    db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'matched')").run(j);
    seedUser(db, "stranger", "x@example.com");
    const r = onUserCreated(db, { id: "stranger", email: "x@example.com" }, { ownerEmail: "Owner@Example.com", profileYaml: null });
    expect(r.becameOwner).toBe(false);
    expect(hasLegacyData(db)).toBe(true);
    expect(r.backfilled).toBe(1);
    seedUser(db, "own", "owner@example.com");
    const r2 = onUserCreated(db, { id: "own", email: "owner@example.com" }, { ownerEmail: "Owner@Example.com", profileYaml: null });
    expect(r2.becameOwner).toBe(true);
    expect((db.prepare("SELECT status FROM applications WHERE user_id = 'own'").get() as { status: string }).status).toBe("matched");
  });

  it("claimLegacyData is idempotent and survives a missing profile.yaml", () => {
    const db = openDb(":memory:");
    seedUser(db, "o", "o@example.com");
    const r = claimLegacyData(db, "o", { profileYaml: path.join(os.tmpdir(), "does-not-exist.yaml") });
    expect(r.profileImported).toBe(false);
    expect(Object.values(r.rows).every((n) => n === 0)).toBe(true);
  });

  it("purgeUserData removes everything the account owns and nothing else", () => {
    const db = openDb(":memory:");
    const j = seedJob(db);
    for (const u of ["a", "b"]) {
      seedUser(db, u, `${u}@example.com`);
      db.prepare("INSERT INTO applications (user_id, job_id, status) VALUES (?,?, 'matched')").run(u, j);
      db.prepare("INSERT INTO matches (user_id, job_id, score) VALUES (?,?, 70)").run(u, j);
      const pid = db.prepare("INSERT INTO people (user_id, name) VALUES (?, 'P')").run(u).lastInsertRowid;
      const oid = db.prepare("INSERT INTO outreach (user_id, person_id, playbook, channel) VALUES (?,?,'referral','linkedin')").run(u, pid).lastInsertRowid;
      db.prepare("INSERT INTO outreach_jobs (outreach_id, job_id) VALUES (?,?)").run(oid, j);
      db.prepare("INSERT INTO resumes (user_id, version_name) VALUES (?, 'v1')").run(u);
      db.prepare("INSERT INTO experiences (user_id, kind, title) VALUES (?, 'work', 'X')").run(u);
      db.prepare("INSERT INTO executor_runs (user_id, kind, status) VALUES (?, 'apply', 'done')").run(u);
      db.prepare("INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES (?, 't', ?, 'sortie_x')").run(u, `hash-${u}`);
      db.prepare("INSERT INTO events (user_id, kind) VALUES (?, 'x')").run(u);
      db.prepare("INSERT INTO profile (key, value) VALUES (?, '{}')").run(`attended_heartbeat:${u}`);
      saveStandardAnswers(db, u, { city: "LA" });
    }
    const counts = purgeUserData(db, "a");
    expect(counts).toMatchObject({ outreach_jobs: 1, outreach: 1, people: 1, matches: 1, applications: 1, resumes: 1, experiences: 1, executor_runs: 1, profiles: 1, api_tokens: 1, events: 1 });
    for (const t of ["applications", "matches", "people", "outreach", "resumes", "experiences", "executor_runs", "api_tokens", "events", "profiles"]) {
      expect((db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = 'b'`).get() as { n: number }).n, t).toBe(1);
      expect((db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = 'a'`).get() as { n: number }).n, t).toBe(0);
    }
    expect((db.prepare("SELECT COUNT(*) n FROM profile").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM jobs").get() as { n: number }).n).toBe(1);
  });
});

describe("profiles (db-backed)", () => {
  it("loadProfile throws a ProfileIncompleteError until a valid profile is saved", () => {
    const db = openDb(":memory:");
    expect(getProfileData(db, "u")).toBeNull();
    expect(() => loadProfile(db, "u")).toThrow(ProfileIncompleteError);
    expect(profileStatus(db, "u")).toEqual({ complete: false, exists: false, issues: [] });
    saveStandardAnswers(db, "u", { city: "LA" });
    const st = profileStatus(db, "u");
    expect(st.exists).toBe(true);
    expect(st.complete).toBe(false);
    expect(st.issues.some((i) => i.startsWith("name"))).toBe(true);
    expect(() => saveProfile(db, "u", { name: "x" })).toThrow();
    const p = importProfileYaml(db, "u", yaml);
    expect(p.name).toBe("Mengjia Shang");
    expect(profileStatus(db, "u").complete).toBe(true);
    expect(loadProfile(db, "u").directions).toEqual({ swe_general: 1 });
  });

  it("saveStandardAnswers replaces the map, trims, drops blank keys and keeps the rest of the profile", () => {
    const db = openDb(":memory:");
    importProfileYaml(db, "u", yaml);
    const saved = saveStandardAnswers(db, "u", { "  ": "ignored", relocation: "  New York  ", high_school: "Chengdu No.7" });
    expect(saved).toEqual({ relocation: "New York", high_school: "Chengdu No.7" });
    const p = loadProfile(db, "u");
    expect(p.standard_answers).toEqual({ relocation: "New York", high_school: "Chengdu No.7" });
    expect(p.work_auth.needs_sponsorship).toBe(true);
    expect(() => saveStandardAnswers(db, "u", { x: 5 as unknown as string })).toThrow();
  });

  it("saveProfile validates and normalizes (defaults applied), per user", () => {
    const db = openDb(":memory:");
    const p = saveProfile(db, "u1", {
      name: "Ann", email: "ann@example.com", phone: "1", linkedin: "", github: "", school: "USC", degree: "MS", grad_date: "2027-05",
      work_auth: { status: "F-1", needs_sponsorship: true }, targets: { primary: "newgrad" }, directions: { mle: 2 },
    });
    expect(p.eeo.gender).toBe("Decline to self-identify");
    expect(p.daily_minutes_budget).toBe(90);
    expect(tryLoadProfile(db, "u2")).toBeNull();
    expect(loadProfile(db, "u1").directions).toEqual({ mle: 2 });
    expect(LEGACY_USER_ID).toBe("legacy");
  });
});
