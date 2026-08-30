import { z } from "zod";
import YAML from "yaml";
import fs from "fs";
import path from "path";

const ProfileSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(3),
  phone: z.string(),
  linkedin: z.string(),
  github: z.string(),
  school: z.string(),
  degree: z.string(),
  grad_date: z.string(),
  work_auth: z.object({
    status: z.string(),
    needs_sponsorship: z.boolean(),
  }),
  targets: z.object({
    primary: z.enum(["newgrad", "intern"]),
    secondary: z.enum(["newgrad", "intern"]).optional(),
  }),
  directions: z.record(z.string(), z.number().int().min(1).max(3)),
  daily_minutes_budget: z.number().default(90),
});

export type Profile = z.infer<typeof ProfileSchema>;

export function parseProfile(yamlText: string): Profile {
  return ProfileSchema.parse(YAML.parse(yamlText));
}

export function loadProfile(): Profile {
  const file = path.join(process.cwd(), "profile", "profile.yaml");
  return parseProfile(fs.readFileSync(file, "utf8"));
}
