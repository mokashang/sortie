import path from "path";
import { z } from "zod";
import { DB } from "@/lib/db";
import { LlmBackend, LlmRequest } from "@/llm/types";
import { extractJson } from "@/llm/extract";
import { listExperiences, Experience } from "@/resume/experiences";
import { DIRECTIONS, directionLabel } from "@/matcher/directions";
import { renderResumeLatex, ResumeContact, ResumeDoc, ResumeSection, ResumeEntry } from "@/resume/latex";
import { extractPdfText } from "@/resume/pdf-text";

export interface CompileResult {
  pdfPath: string;
  pages: number;
}
export type Compiler = (tex: string, outPdfPath: string) => Promise<CompileResult>;

// versionName is user-supplied and gets joined into a filesystem path (outDir/<versionName>.tex
// / .pdf). Reject anything with a path separator or a ".." segment so it can't escape outDir.
export function isSafeVersionName(name: string): boolean {
  return !/[/\\]|\.\./.test(name);
}

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
  // Extracts plain text from a compiled PDF for the content self-check. Defaults to the real
  // pdftotext-backed extractPdfText; tests inject a fake so they don't need pdftotext installed.
  extractText?: (pdfPath: string) => Promise<string | null>;
}

export interface GenerateResult {
  resumeId: number;
  texPath: string;
  pdfPath: string;
  pages: number;
  trimmed: number;
  warnings: string[];
}

// The spec calls for "up to 6 attempts" as a default expectation for a normally-sized
// selection. In practice the LLM's selection size varies a fair amount run to run (observed:
// anywhere from ~5 to ~9 experience/project entries with 1-3 bullets each, well beyond the
// "usually 3-5 experiences" the prompt asks for) — and since each attempt is just one
// deterministic trim + one cheap local tectonic recompile (~1-3s once fonts are cached, and
// the loop provably terminates: it either converges, or runs out of anything left to trim),
// the budget is set generously here so 1-page convergence isn't at the mercy of how verbose a
// given completion happened to be.
const MAX_TRIM_ATTEMPTS = 20;

function isEducationHeading(heading: string): boolean {
  return heading.toLowerCase().includes("education");
}

// Deep-clones the doc and applies exactly one deterministic trim:
//   1. Among entries with more than one bullet, drop the last bullet of the entry currently
//      carrying the most bullet TEXT (total characters across its bullets — a much better
//      proxy for the vertical space an entry occupies than raw bullet count, since real
//      bullets vary hugely in length). Ties go to the first such entry in section/entry order.
//   2. If every entry already has <=1 bullet, drop the lowest-priority whole entry instead:
//      the last entry of the last non-education section that still has entries.
// Returns null if there is nothing left to trim.
function trimOneStep(doc: ResumeDoc): { doc: ResumeDoc; description: string } | null {
  const sections: ResumeSection[] = doc.sections.map((s) => ({
    heading: s.heading,
    entries: s.entries.map((e) => ({ ...e, bullets: [...e.bullets] })),
  }));

  let maxChars = -1;
  let target: { si: number; ei: number } | null = null;
  for (let si = 0; si < sections.length; si++) {
    for (let ei = 0; ei < sections[si].entries.length; ei++) {
      const bullets = sections[si].entries[ei].bullets;
      if (bullets.length <= 1) continue; // not eligible for bullet-level trim
      const chars = bullets.reduce((sum, b) => sum + b.length, 0);
      if (chars > maxChars) {
        maxChars = chars;
        target = { si, ei };
      }
    }
  }
  if (target) {
    const entry = sections[target.si].entries[target.ei];
    entry.bullets.pop();
    return { doc: { contact: doc.contact, sections }, description: `dropped a bullet from "${entry.title}"` };
  }

  for (let si = sections.length - 1; si >= 0; si--) {
    if (isEducationHeading(sections[si].heading)) continue;
    if (sections[si].entries.length === 0) continue;
    const removed = (sections[si].entries as ResumeEntry[]).pop();
    return { doc: { contact: doc.contact, sections }, description: `dropped entry "${removed?.title}"` };
  }

  return null; // nothing left to trim
}

// Validates the extracted PDF text against the doc that produced it: candidate name present,
// no raw LaTeX command markers leaked through (compile succeeded but text extraction found
// literal macro text — usually a sign of a mismatched engine/macro), and non-trivial content.
function checkResumeContent(doc: ResumeDoc, text: string): string[] {
  const warnings: string[] = [];
  if (doc.contact.name && !text.includes(doc.contact.name)) {
    warnings.push(`extracted PDF text does not contain the candidate name "${doc.contact.name}"`);
  }
  for (const marker of ["\\resume", "\\text", "\\section"]) {
    if (text.includes(marker)) {
      warnings.push(`extracted PDF text appears to leak raw LaTeX (found "${marker}")`);
    }
  }
  if (text.trim().length < 40) {
    warnings.push("extracted PDF text looks empty or too short");
  }
  return warnings;
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
  let doc = buildDoc(opts.contact, experiences, selection);

  const texPath = path.join(opts.outDir, `${opts.versionName}.tex`);
  const pdfPath = path.join(opts.outDir, `${opts.versionName}.pdf`);
  const fs = await import("fs");
  fs.mkdirSync(opts.outDir, { recursive: true });

  let tex = renderResumeLatex(doc);
  fs.writeFileSync(texPath, tex);
  let compiled = await opts.compile(tex, pdfPath);

  // Strict one-page enforcement: deterministically trim content and recompile until it fits
  // on one page, or we exhaust the attempt budget / run out of anything left to trim.
  let trimmed = 0;
  let attempts = 0;
  while (compiled.pages > 1 && attempts < MAX_TRIM_ATTEMPTS) {
    const step = trimOneStep(doc);
    if (!step) break;
    doc = step.doc;
    trimmed++;
    attempts++;
    tex = renderResumeLatex(doc);
    fs.writeFileSync(texPath, tex);
    compiled = await opts.compile(tex, pdfPath);
  }

  // Content self-check: extract text from the final PDF and sanity-check it. This never fails
  // generation — it only surfaces warnings, and is skipped gracefully if extraction is
  // unavailable (e.g. pdftotext not installed).
  const extractText = opts.extractText ?? extractPdfText;
  const warnings: string[] = [];
  const text = await extractText(compiled.pdfPath);
  if (text !== null) {
    warnings.push(...checkResumeContent(doc, text));
  }
  if (compiled.pages > 1) {
    warnings.push(`resume still spans ${compiled.pages} pages after ${trimmed} trim attempt(s)`);
  }

  db.prepare(
    `INSERT INTO resumes (version_name, directions, tex_path, pdf_path, compiled_at)
     VALUES (?,?,?,?, datetime('now'))
     ON CONFLICT(version_name) DO UPDATE SET directions=excluded.directions, tex_path=excluded.tex_path, pdf_path=excluded.pdf_path, compiled_at=excluded.compiled_at`
  ).run(opts.versionName, JSON.stringify([opts.direction]), texPath, compiled.pdfPath);
  // SQLite's last_insert_rowid() is NOT reset by ON CONFLICT DO UPDATE — it keeps the last real
  // INSERT's rowid on the connection, so `info.lastInsertRowid` can be a stale id from an earlier
  // insert when this call takes the UPDATE branch. Always resolve by the unique key instead.
  const resumeId = (db.prepare("SELECT id FROM resumes WHERE version_name=?").get(opts.versionName) as { id: number }).id;

  return { resumeId, texPath, pdfPath: compiled.pdfPath, pages: compiled.pages, trimmed, warnings };
}
