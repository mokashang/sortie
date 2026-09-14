import { z } from "zod";
import YAML from "yaml";
import path from "path";
import type { DB } from "@/lib/db";

// One profile per account, stored as JSON in the `profiles` table (schema v15). Before accounts
// this was the hand-edited profile/profile.yaml; that file is now only an import source (the
// owner's first sign-up imports it, 档案页 can re-import it). The validation schema is unchanged.

const ProfileSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string(),
    linkedin: z.string(),
    github: z.string(),
    school: z.string(),
    degree: z.string(),
    grad_date: z.string().regex(/^\d{4}-\d{2}$/, "grad_date must be in YYYY-MM format"),
    work_auth: z.object({
      status: z.string(),
      needs_sponsorship: z.boolean(),
    }),
    targets: z.object({
      primary: z.enum(["newgrad", "intern"]),
      secondary: z.enum(["newgrad", "intern"]).optional(),
    }),
    directions: z
      .record(z.string(), z.number().int().min(1).max(3))
      .refine((d) => Object.keys(d).length > 0, { message: "directions must not be empty" }),
    daily_minutes_budget: z.number().default(90),
    // Apply-executor answer pack fields (optional/backward-compatible — existing profile.yaml
    // files without these keys still parse, picking up the defaults below).
    eeo: z
      .object({
        gender: z.string().default("Decline to self-identify"),
        race: z.string().default("Decline to self-identify"),
        veteran: z.string().default("I am not a protected veteran"),
        disability: z.string().default("I do not want to answer"),
      })
      .default({}),
    standard_answers: z.record(z.string(), z.string()).default({}), // e.g. {"How did you hear": "Company website"}
  })
  .strict();

export type Profile = z.infer<typeof ProfileSchema>;
export { ProfileSchema };

// The fields a person must fill before the assistant can match/apply for them (everything the
// schema requires without a default). Used by the 档案 editor and the 今日 setup banner.
export const REQUIRED_PROFILE_FIELDS = ["name", "email", "phone", "linkedin", "github", "school", "degree", "grad_date", "work_auth", "targets", "directions"] as const;

export class ProfileIncompleteError extends Error {
  issues: string[];
  constructor(userId: string, issues: string[]) {
    super(`profile for ${userId} is incomplete: ${issues.join("; ") || "no profile saved yet"}`);
    this.name = "ProfileIncompleteError";
    this.issues = issues;
  }
}

export function parseProfile(yamlText: string): Profile {
  return ProfileSchema.parse(YAML.parse(yamlText));
}

export function parseProfileData(data: unknown): Profile {
  return ProfileSchema.parse(data);
}

// Where the pre-accounts profile file lives; only read when an owner claims the legacy bucket
// or explicitly re-imports from 档案页.
export function profileYamlPath(cwd = process.cwd()): string {
  return path.join(cwd, "profile", "profile.yaml");
}

// Raw stored object (may be partial or empty while the user is still filling the editor).
export function getProfileData(db: DB, userId: string): Record<string, unknown> | null {
  const row = db.prepare("SELECT data FROM profiles WHERE user_id = ?").get(userId) as { data: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface ProfileStatus {
  complete: boolean;
  exists: boolean;
  issues: string[]; // human-readable zod issues (path: message)
}

export function profileStatus(db: DB, userId: string): ProfileStatus {
  const data = getProfileData(db, userId);
  if (data === null) return { complete: false, exists: false, issues: [] };
  const r = ProfileSchema.safeParse(data);
  if (r.success) return { complete: true, exists: true, issues: [] };
  return { complete: false, exists: true, issues: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

// The validated profile the matcher / answer pack / draft engine work from. Throws
// ProfileIncompleteError (mapped to a clear 409 by the API layer) instead of a raw zod error.
export function loadProfile(db: DB, userId: string): Profile {
  const data = getProfileData(db, userId);
  if (data === null) throw new ProfileIncompleteError(userId, []);
  const r = ProfileSchema.safeParse(data);
  if (!r.success) throw new ProfileIncompleteError(userId, r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  return r.data;
}

export function tryLoadProfile(db: DB, userId: string): Profile | null {
  try {
    return loadProfile(db, userId);
  } catch (e) {
    if (e instanceof ProfileIncompleteError) return null;
    throw e;
  }
}

function writeProfileData(db: DB, userId: string, data: Record<string, unknown>): void {
  db.prepare(
    "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"
  ).run(userId, JSON.stringify(data));
}

// The 档案页 editor's write path: the whole profile must validate (so nothing downstream ever
// sees a half-filled one). Returns the normalized profile (defaults applied).
export function saveProfile(db: DB, userId: string, data: unknown): Profile {
  const profile = ProfileSchema.parse(data);
  writeProfileData(db, userId, profile);
  return profile;
}

// Replaces the whole standard_answers map (the editor always sends the full table) and leaves
// every other key untouched — also works on a not-yet-complete profile, since 待补信息 answers
// may arrive before the rest is filled in.
export function saveStandardAnswers(db: DB, userId: string, answers: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(answers ?? {})) {
    const key = rawKey.trim();
    if (!key) continue;
    if (typeof rawValue !== "string") throw new Error(`saveStandardAnswers: value for '${key}' must be a string`);
    cleaned[key] = rawValue.trim();
  }
  const current = getProfileData(db, userId) ?? {};
  writeProfileData(db, userId, { ...current, standard_answers: cleaned });
  return cleaned;
}

// Import a profile.yaml (the pre-accounts format) into an account. Validates first, so a bad file
// never overwrites a good stored profile.
export function importProfileYaml(db: DB, userId: string, yamlText: string): Profile {
  const profile = parseProfile(yamlText);
  writeProfileData(db, userId, profile);
  return profile;
}

// A blank editor state for a new account (the same defaults the schema would apply, plus the
// account's own name/email so the first fields are pre-filled).
export function emptyProfileData(seed: { name?: string; email?: string } = {}): Record<string, unknown> {
  return {
    name: seed.name ?? "",
    email: seed.email ?? "",
    phone: "",
    linkedin: "",
    github: "",
    school: "",
    degree: "",
    grad_date: "",
    work_auth: { status: "F-1", needs_sponsorship: true },
    targets: { primary: "newgrad" },
    directions: {},
    daily_minutes_budget: 90,
    eeo: {
      gender: "Decline to self-identify",
      race: "Decline to self-identify",
      veteran: "I am not a protected veteran",
      disability: "I do not want to answer",
    },
    standard_answers: {},
  };
}
