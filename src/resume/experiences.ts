import { z } from "zod";
import { DB } from "@/lib/db";
import { isKnownDirection } from "@/matcher/directions";

export const KINDS = ["education", "work", "project", "skill", "award", "publication"] as const;

const BulletSchema = z.object({
  text: z.string().min(1),
  directions: z.array(z.string().refine(isKnownDirection, "unknown direction")).default([]),
});
export const ExperienceInputSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().min(1),
  organization: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  bullets: z.array(BulletSchema).default([]),
  sort_order: z.number().int().default(0),
});
export type ExperienceInput = z.infer<typeof ExperienceInputSchema>;

export interface Experience extends ExperienceInput {
  id: number;
}

interface Row {
  id: number; kind: string; title: string; organization: string | null; location: string | null;
  start_date: string | null; end_date: string | null; bullets: string; sort_order: number;
}

function rowToExperience(r: Row): Experience {
  return {
    id: r.id, kind: r.kind as ExperienceInput["kind"], title: r.title,
    organization: r.organization, location: r.location,
    start_date: r.start_date, end_date: r.end_date,
    bullets: JSON.parse(r.bullets), sort_order: r.sort_order,
  };
}

// The experience bank is per account: every function takes the acting user and an update/delete
// of another account's row is reported as unknown.
export function createExperience(db: DB, userId: string, input: ExperienceInput): number {
  const e = ExperienceInputSchema.parse(input);
  const info = db
    .prepare(
      `INSERT INTO experiences (user_id, kind, title, organization, location, start_date, end_date, bullets, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(userId, e.kind, e.title, e.organization ?? null, e.location ?? null, e.start_date ?? null, e.end_date ?? null, JSON.stringify(e.bullets), e.sort_order);
  return Number(info.lastInsertRowid);
}

export function listExperiences(db: DB, userId: string): Experience[] {
  const rows = db
    .prepare("SELECT id, kind, title, organization, location, start_date, end_date, bullets, sort_order FROM experiences WHERE user_id = ? ORDER BY kind ASC, sort_order ASC, id ASC")
    .all(userId) as Row[];
  return rows.map(rowToExperience);
}

export function updateExperience(db: DB, userId: string, id: number, input: ExperienceInput): void {
  const e = ExperienceInputSchema.parse(input);
  const info = db.prepare(
    `UPDATE experiences SET kind=?, title=?, organization=?, location=?, start_date=?, end_date=?, bullets=?, sort_order=? WHERE user_id=? AND id=?`
  ).run(e.kind, e.title, e.organization ?? null, e.location ?? null, e.start_date ?? null, e.end_date ?? null, JSON.stringify(e.bullets), e.sort_order, userId, id);
  if (info.changes === 0) throw new Error(`updateExperience: unknown experience ${id}`);
}

export function deleteExperience(db: DB, userId: string, id: number): void {
  db.prepare("DELETE FROM experiences WHERE user_id = ? AND id = ?").run(userId, id);
}
