import path from "path";
import { z } from "zod";
import { DB } from "@/lib/db";
import { LlmBackend, LlmRequest } from "@/llm/types";
import { extractJson } from "@/llm/extract";
import { listExperiences, Experience } from "@/resume/experiences";
import { DIRECTIONS, directionLabel } from "@/matcher/directions";
import { renderResumeLatex, ResumeContact, ResumeDoc, ResumeSection } from "@/resume/latex";

export type Compiler = (tex: string, outPdfPath: string) => Promise<string>;

const SelectionSchema = z.object({
  sections: z.array(
    z.object({
      heading: z.string().min(1),
      entry_ids: z.array(z.number().int()).optional(),
      entries: z
        .array(z.object({ id: z.number().int(), bullets: z.array(z.string()) }))
        .optional(),
    })
  ),
});
export type Selection = z.infer<typeof SelectionSchema>;

export interface GenerateOptions {
  backend: LlmBackend;
  contact: ResumeContact;
  direction: string;
  versionName: string;
  compile: Compiler;
  outDir: string;
}

export interface GenerateResult {
  resumeId: number;
  texPath: string;
  pdfPath: string;
}

function buildPrompt(experiences: Experience[], direction: string): LlmRequest {
  const dirLabel = directionLabel(direction);
  const blurb = DIRECTIONS[direction]?.blurb ?? "";
  const expJson = experiences.map((e) => ({
    id: e.id, kind: e.kind, title: e.title, organization: e.organization,
    location: e.location, start_date: e.start_date, end_date: e.end_date,
    bullets: e.bullets.map((b) => b.text),
  }));
  const system =
    "You are an expert technical resume writer. From a candidate's full experience bank, you select and order the most relevant items for ONE target direction and pick/lightly-tighten the strongest bullets. You never invent facts — only reuse or trim the provided bullet text. Return ONLY JSON.";
  const prompt =
    `Target direction: ${dirLabel} — ${blurb}\n\n` +
    `Candidate experience bank (JSON):\n${JSON.stringify(expJson, null, 2)}\n\n` +
    `Produce a one-page resume selection as JSON with this shape:\n` +
    `{ "sections": [ { "heading": "Education", "entry_ids": [<id>...] }, ` +
    `{ "heading": "Experience", "entries": [ { "id": <id>, "bullets": ["<chosen or tightened bullet text>", ...] } ] } ] }\n` +
    `Rules: use only ids from the bank; for education/skills you may use entry_ids (all bullets kept); for work/projects use entries with a curated bullets array; ` +
    `prioritize items relevant to ${dirLabel}; keep it to ~1 page (usually 3-5 experiences). Bullet text MUST be copied or trimmed from the provided bullets — do not fabricate. Output ONLY the JSON.`;
  return { system, prompt, tier: "smart", maxTokens: 3000 };
}

function buildDoc(contact: ResumeContact, experiences: Experience[], selection: Selection): ResumeDoc {
  const byId = new Map(experiences.map((e) => [e.id, e]));
  const sections: ResumeSection[] = selection.sections.map((s) => {
    const entries = [] as ResumeSection["entries"];
    for (const id of s.entry_ids ?? []) {
      const e = byId.get(id);
      if (!e) throw new Error(`generateResume: unknown experience id ${id}`);
      entries.push({ title: e.title, organization: e.organization, location: e.location, dates: dateRange(e), bullets: e.bullets.map((b) => b.text) });
    }
    for (const sel of s.entries ?? []) {
      const e = byId.get(sel.id);
      if (!e) throw new Error(`generateResume: unknown experience id ${sel.id}`);
      entries.push({ title: e.title, organization: e.organization, location: e.location, dates: dateRange(e), bullets: sel.bullets });
    }
    return { heading: s.heading, entries };
  });
  return { contact, sections };
}

function dateRange(e: Experience): string | null {
  if (e.start_date && e.end_date) return `${e.start_date} – ${e.end_date}`;
  return e.start_date ?? e.end_date ?? null;
}

export async function generateResume(db: DB, opts: GenerateOptions): Promise<GenerateResult> {
  const experiences = listExperiences(db);
  const req = buildPrompt(experiences, opts.direction);
  const res = await opts.backend.complete(req);
  const selection = SelectionSchema.parse(extractJson(res.text));
  const doc = buildDoc(opts.contact, experiences, selection);
  const tex = renderResumeLatex(doc);

  const texPath = path.join(opts.outDir, `${opts.versionName}.tex`);
  const pdfPath = path.join(opts.outDir, `${opts.versionName}.pdf`);
  const fs = await import("fs");
  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(texPath, tex);
  await opts.compile(tex, pdfPath);

  const info = db
    .prepare(
      `INSERT INTO resumes (version_name, directions, tex_path, pdf_path, compiled_at)
       VALUES (?,?,?,?, datetime('now'))
       ON CONFLICT(version_name) DO UPDATE SET directions=excluded.directions, tex_path=excluded.tex_path, pdf_path=excluded.pdf_path, compiled_at=excluded.compiled_at`
    )
    .run(opts.versionName, JSON.stringify([opts.direction]), texPath, pdfPath);
  const resumeId = info.lastInsertRowid
    ? Number(info.lastInsertRowid)
    : (db.prepare("SELECT id FROM resumes WHERE version_name=?").get(opts.versionName) as { id: number }).id;

  return { resumeId, texPath, pdfPath };
}
