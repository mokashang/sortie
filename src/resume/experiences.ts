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

export function createExperience(db: DB, input: ExperienceInput): number {
  const e = ExperienceInputSchema.parse(input);
  const info = db
    .prepare(
      `INSERT INTO experiences (kind, title, organization, location, start_date, end_date, bullets, sort_order)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(e.kind, e.title, e.organization ?? null, e.location ?? null, e.start_date ?? null, e.end_date ?? null, JSON.stringify(e.bullets), e.sort_order);
  return Number(info.lastInsertRowid);
}

export function listExperiences(db: DB): Experience[] {
  const rows = db.prepare("SELECT * FROM experiences ORDER BY kind ASC, sort_order ASC, id ASC").all() as Row[];
  return rows.map(rowToExperience);
}

export function updateExperience(db: DB, id: number, input: ExperienceInput): void {
  const e = ExperienceInputSchema.parse(input);
  db.prepare(
    `UPDATE experiences SET kind=?, title=?, organization=?, location=?, start_date=?, end_date=?, bullets=?, sort_order=? WHERE id=?`
  ).run(e.kind, e.title, e.organization ?? null, e.location ?? null, e.start_date ?? null, e.end_date ?? null, JSON.stringify(e.bullets), e.sort_order, id);
}

export function deleteExperience(db: DB, id: number): void {
  db.prepare("DELETE FROM experiences WHERE id=?").run(id);
}
