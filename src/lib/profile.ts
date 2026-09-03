import { z } from "zod";
import YAML from "yaml";
import fs from "fs";
import path from "path";

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

export function parseProfile(yamlText: string): Profile {
  return ProfileSchema.parse(YAML.parse(yamlText));
}

export function loadProfile(file?: string): Profile {
  const target = file ?? path.join(process.cwd(), "profile", "profile.yaml");
  return parseProfile(fs.readFileSync(target, "utf8"));
}

// The /profile page's 标准答案 editor writes here (PUT /api/profile/standard-answers). Replaces
// the whole standard_answers map — the editor always sends the full table — and leaves every
// other key untouched. Goes through YAML's document API (not parse → stringify) so the user's
// hand-written comments in profile.yaml survive the round trip. Validates the result with the
// same schema loadProfile uses before writing, so a bad edit can never leave the file unloadable.
export function saveStandardAnswers(answers: Record<string, string>, file?: string): void {
  const target = file ?? path.join(process.cwd(), "profile", "profile.yaml");
  const cleaned: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(answers ?? {})) {
    const key = rawKey.trim();
    if (!key) continue;
    if (typeof rawValue !== "string") throw new Error(`saveStandardAnswers: value for '${key}' must be a string`);
    cleaned[key] = rawValue.trim();
  }
  const doc = YAML.parseDocument(fs.readFileSync(target, "utf8"));
  doc.set("standard_answers", cleaned);
  const text = doc.toString();
  parseProfile(text); // throws if the edit would break the schema
  fs.writeFileSync(target, text);
}
