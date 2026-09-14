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
  // Count of "Overfull \hbox" occurrences in the compile log, and the worst (max) pt-too-wide
  // value among them — see src/resume/compile.ts's parseOverfullHboxes. A fixed-width table
  // cell with unwrapped text that runs off the page shows up here even when pages stays 1.
  overfullCount: number;
  worstOverfullPt: number;
}
export type Compiler = (tex: string, outPdfPath: string) => Promise<CompileResult>;

// versionName is user-supplied and gets joined into a filesystem path (outDir/<versionName>.tex
// / .pdf). Reject anything with a path separator or a ".." segment so it can't escape outDir.
export function isSafeVersionName(name: string): boolean {
  return !/[/\\]|\.\./.test(name);
}

// The model no longer chooses section HEADINGS or structure — it only selects which
// experiences to include and which (reworded/angled) bullets to use for each. Structure is
// deterministic: see SECTION_ORDER below. Each bullet must be non-empty (validated here); it
// need not exactly match the source bullet text (angling may reword it), but the prompt
// instructs the model never to fabricate content not present in the source bullets.
const SelectionSchema = z.object({
  include: z.array(
    z.object({
      id: z.number().int(),
      bullets: z.array(z.string().min(1)),
    })
  ),
});
export type Selection = z.infer<typeof SelectionSchema>;

// Fixed section structure, keyed by experience `kind`, in the fixed order the resume renders
// them. A section is omitted entirely when nothing of that kind was included (see buildDoc).
const SECTION_ORDER: { kind: Experience["kind"]; heading: string }[] = [
  { kind: "education", heading: "Education" },
  { kind: "work", heading: "Experience" },
  { kind: "project", heading: "Projects" },
  { kind: "skill", heading: "Technical Skills" },
];

export interface GenerateOptions {
  // The account whose experience bank is used and whose resumes row is written.
  userId: string;
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
  overfullCount: number;
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

// Below this many points-too-wide, an Overfull \hbox is font-metric noise (sub-pixel at
// render size) rather than content actually running off the page — not worth burning a trim
// attempt on. Above it, real content is bleeding past the margin and gets treated exactly like
// a page-count overflow: trim one step and recompile.
const OVERFULL_THRESHOLD_PT = 2;

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
    bullets: e.bullets.map((b) => ({ text: b.text, directions: b.directions })),
  }));
  const system =
    "You are an expert technical resume writer. From a candidate's full experience bank, you SELECT which experiences to include for ONE target direction and choose/lightly-angle the strongest bullets for each. " +
    "You never invent facts, technologies, or results — you only reuse, trim, or re-emphasize wording already present in the provided bullet text. Return ONLY JSON.";
  const prompt =
    `Target direction: ${dirLabel} — ${blurb}\n\n` +
    `Candidate experience bank (JSON). Each bullet carries a "directions" tag array showing which directions it is genuinely relevant to (from the candidate's own prior tagging) — use this as a hint for relevance, not a hard filter:\n` +
    `${JSON.stringify(expJson, null, 2)}\n\n` +
    `Produce a resume SELECTION as JSON with this exact shape (do not invent any other structure):\n` +
    `{ "include": [ { "id": <experience id from the bank>, "bullets": ["<chosen or lightly-angled bullet text>", ...] }, ... ] }\n\n` +
    `Rules:\n` +
    `- Use only ids that appear in the bank above.\n` +
    `- Do NOT choose section headings or structure yourself — the app deterministically places each included id's kind (education / work / project / skill) into a fixed section (Education / Experience / Projects / Technical Skills). You only choose WHICH ids to include, WHICH bullets, and in what order.\n` +
    `- Order matters: list the ids for a given kind in the order you want them to appear, most-relevant-to-${dirLabel}-first.\n` +
    `- Include roughly 3-5 of the strongest, most relevant work/project entries (plus all education entries and 2-4 skill entries) — keep it to about one page.\n` +
    `- For education entries, keep the bullets array as given (or empty).\n` +
    `- For skill entries, you may merge/curate/reorder the bullet text, but every word must trace back to something already in that entry's bullets — do not add tools or techniques that aren't there.\n\n` +
    `DIRECTION ANGLING (do this, honestly):\n` +
    `- Prioritize and order the most ${dirLabel}-relevant experiences FIRST within each section.\n` +
    `- Where a REAL experience genuinely touches ${dirLabel}, phrase/emphasize that bullet toward this angle — e.g. for gpu_cuda emphasize real CUDA/FlashAttention/BF16/memory-profiling work; for quant emphasize real C++/low-latency/probability work; for systems_perf emphasize real profiling/latency work.\n` +
    `- You may lightly reword a bullet to foreground the ${dirLabel}-relevant part of what it already says (e.g. reorder clauses, trim an unrelated clause), but the underlying facts, numbers, and technologies must already be present in that bullet's original text.\n\n` +
    `HARD CONSTRAINT — NEVER FABRICATE:\n` +
    `- NEVER invent facts, technologies, metrics, or results that are not present in the source bullets, even if they would make the resume a better fit for ${dirLabel}.\n` +
    `- If the candidate has essentially nothing real for ${dirLabel}, do not manufacture direction-specific accomplishments — just select and lightly angle the strongest adjacent real work instead.\n` +
    `- Every bullet you output must be traceable to real content already in the bank above.\n\n` +
    `Output ONLY the JSON, no commentary.`;
  return { system, prompt, tier: "smart", maxTokens: 3000 };
}

// Deterministically builds the ResumeDoc's section structure from the model's flat `include`
// list: each included id is routed into the fixed section for its experience `kind` (see
// SECTION_ORDER), in SECTION_ORDER's fixed order. Within a section, entries keep the relative
// order they appear in `include` (the model's chosen priority/angling order) — DB sort_order is
// not consulted since `include`'s order fully determines it. A section is omitted when it has
// zero included entries.
function buildDoc(contact: ResumeContact, experiences: Experience[], selection: Selection): ResumeDoc {
  const byId = new Map(experiences.map((e) => [e.id, e]));
  const resolved = selection.include.map((sel) => {
    const e = byId.get(sel.id);
    if (!e) throw new Error(`generateResume: unknown experience id ${sel.id}`);
    return { exp: e, bullets: sel.bullets };
  });

  const sections: ResumeSection[] = [];
  for (const { kind, heading } of SECTION_ORDER) {
    const entries: ResumeEntry[] = resolved
      .filter((r) => r.exp.kind === kind)
      .map((r) => ({
        title: r.exp.title,
        organization: r.exp.organization,
        location: r.exp.location,
        dates: dateRange(r.exp),
        bullets: r.bullets,
      }));
    if (entries.length > 0) sections.push({ heading, entries });
  }
  return { contact, sections };
}

function dateRange(e: Experience): string | null {
  if (e.start_date && e.end_date) {
    if (e.start_date === e.end_date) return e.start_date; // "2026 – 2026" → "2026"
    return `${e.start_date} – ${e.end_date}`;
  }
  return e.start_date ?? e.end_date ?? null;
}

export async function generateResume(db: DB, opts: GenerateOptions): Promise<GenerateResult> {
  const experiences = listExperiences(db, opts.userId);
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
  // on one page AND has no meaningful horizontal overflow, or we exhaust the attempt budget /
  // run out of anything left to trim. Page count alone misses horizontal overflow entirely —
  // content can run off the right edge of a fixed-width page without ever pushing a second
  // page into existence — so an Overfull \hbox past OVERFULL_THRESHOLD_PT is treated as the
  // same kind of defect as pages>1 and drives the identical trim/recompile cycle.
  const isDefective = (r: CompileResult) => r.pages > 1 || (r.overfullCount > 0 && r.worstOverfullPt > OVERFULL_THRESHOLD_PT);
  let trimmed = 0;
  let attempts = 0;
  while (isDefective(compiled) && attempts < MAX_TRIM_ATTEMPTS) {
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
  if (compiled.overfullCount > 0) {
    warnings.push(
      `resume still has ${compiled.overfullCount} overfull hbox line(s) after ${trimmed} trim attempt(s) (worst: ${compiled.worstOverfullPt.toFixed(1)}pt too wide)`
    );
  }

  db.prepare(
    `INSERT INTO resumes (user_id, version_name, directions, tex_path, pdf_path, compiled_at)
     VALUES (?,?,?,?,?, datetime('now'))
     ON CONFLICT(user_id, version_name) DO UPDATE SET directions=excluded.directions, tex_path=excluded.tex_path, pdf_path=excluded.pdf_path, compiled_at=excluded.compiled_at`
  ).run(opts.userId, opts.versionName, JSON.stringify([opts.direction]), texPath, compiled.pdfPath);
  // SQLite's last_insert_rowid() is NOT reset by ON CONFLICT DO UPDATE — it keeps the last real
  // INSERT's rowid on the connection, so `info.lastInsertRowid` can be a stale id from an earlier
  // insert when this call takes the UPDATE branch. Always resolve by the unique key instead.
  const resumeId = (db.prepare("SELECT id FROM resumes WHERE user_id=? AND version_name=?").get(opts.userId, opts.versionName) as { id: number }).id;

  return { resumeId, texPath, pdfPath: compiled.pdfPath, pages: compiled.pages, trimmed, overfullCount: compiled.overfullCount, warnings };
}
