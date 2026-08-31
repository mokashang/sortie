# JobSeeker OS — Plan 3: Resume Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 Resume Studio:用户在 UI 里像填网申 Profile 一样录入结构化经历(教育/经历/项目/技能),然后选一个方向,由 Claude 从这些经历里选条目、组 bullet,套 LaTeX 模板,用 tectonic 编译出 PDF;可在 UI 预览、编辑、生成多个方向的简历版本,定稿版进入简历库供匹配引擎按岗位选用。

**Architecture:** 经历数据存 SQLite(新表 `experiences`,复用 Plan 1 已有的 `resumes` 表存生成的版本)。经历录入是纯 CRUD(表单 UI + REST)。生成引擎复用 Plan 2 的 `LlmBackend`(订阅后端):把用户经历 + 目标方向喂给 Claude,要求它输出"选哪些条目、每条用哪些/改写的 bullet + 段落顺序"的结构化 JSON;一个纯函数把该 JSON + 用户联系信息渲染成 LaTeX;tectonic 编译成 PDF 存盘。UI 三块:Profile 录入页、Resume Studio 生成/预览页、简历库列表。**内容全部由用户在 UI 录入,不导入现有材料。**

**Tech Stack:** 沿用(Next.js 15 / TS strict / better-sqlite3 / vitest / zod / Plan 2 的 src/llm)。新增运行时依赖:tectonic(`/opt/homebrew/bin/tectonic`,已装)。Spec §5.1。

**约定(通用):**
- 仓库根 `/Users/moka/Documents/job_seeker`。测试 `npx vitest run <file>`,单测注入 fake backend / `:memory:` DB / 不真编译 LaTeX(编译走注入的 fake compiler)。
- LaTeX 编译、真实 LLM 生成只在明确标注的 smoke 步骤发生。
- 生成的 PDF/tex 存 `data/resumes/`(gitignored,随 data/ 已忽略)。

**已知上游事实:**
- `resumes` 表(Plan 1):`id, version_name UNIQUE, directions TEXT(JSON), tex_path, pdf_path, compiled_at`。
- `profile` 表 + `loadProfile()`:个人联系信息在 `profile/profile.yaml`(name/email/phone/linkedin/github/school/degree/grad_date)。
- `src/llm/registry.ts` `getBackend()`;`src/llm/extract.ts` `extractJson`;`src/matcher/directions.ts` `DIRECTIONS`(12 方向 label+blurb)。
- 生成的简历版本被匹配引擎的 `matches.resume_id` 引用(Plan 2 未填该列;本 plan 让 Studio 定稿的版本可被选,后续 plan 在申请执行时按方向选 resume)。

---

### Task 1: experiences 表 + schema 迁移

**Files:**
- Modify: `src/lib/schema.sql`(加 experiences 表;bump user_version)
- Modify: `src/lib/db.ts`(SCHEMA_VERSION → 2)
- Test: `tests/experiences-schema.test.ts`

- [ ] **Step 1: 在 schema.sql 末尾(索引之前)加 experiences 表**

```sql
CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- education | work | project | skill | award | publication
  title TEXT NOT NULL,             -- 职位名 / 项目名 / 学位 / 技能组名
  organization TEXT,               -- 公司 / 学校 / 会议(skill 可空)
  location TEXT,
  start_date TEXT,                 -- 自由文本,如 "2025-09" 或 "Sep 2025"
  end_date TEXT,                   -- 自由文本 或 "Present"
  bullets TEXT NOT NULL DEFAULT '[]',   -- JSON: [{ text, directions: [slug,...] }]
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_experiences_kind ON experiences(kind, sort_order);
CREATE TRIGGER IF NOT EXISTS trg_experiences_updated AFTER UPDATE ON experiences
BEGIN UPDATE experiences SET updated_at = datetime('now') WHERE id = NEW.id; END;
```

- [ ] **Step 2: 写失败测试 tests/experiences-schema.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";

describe("experiences schema", () => {
  it("creates the experiences table with an updated_at trigger", () => {
    const db = openDb(":memory:");
    const info = db
      .prepare("INSERT INTO experiences (kind, title, organization, bullets) VALUES (?,?,?,?)")
      .run("project", "Distributed Trainer", "USC", JSON.stringify([{ text: "Built X", directions: ["ai_infra"] }]));
    const row = db.prepare("SELECT title, bullets FROM experiences WHERE id=?").get(info.lastInsertRowid) as any;
    expect(row.title).toBe("Distributed Trainer");
    expect(JSON.parse(row.bullets)[0].directions).toEqual(["ai_infra"]);
  });
  it("reports user_version 2", () => {
    const db = openDb(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(2);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/experiences-schema.test.ts`
Expected: FAIL(user_version 仍是 1,且/或表不存在——取决于 db.ts 当前值)

- [ ] **Step 4: 改 src/lib/db.ts 的 SCHEMA_VERSION**

把 `const SCHEMA_VERSION = 1;` 改为 `const SCHEMA_VERSION = 2;`。(schema.sql 用 `CREATE TABLE IF NOT EXISTS`,对已有 db 幂等追加新表;真实 data/jobseeker.db 下次打开即获得 experiences 表。)

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/experiences-schema.test.ts`
Expected: 2 passed

- [ ] **Step 6: 全量测试(确认没破坏 Plan1/2 的 db 测试)**

Run: `npx vitest run tests/db.test.ts tests/experiences-schema.test.ts`
Expected: 全通过(db.test.ts 里若断言 user_version===1 需同步改为 2——若失败,更新该断言)

- [ ] **Step 7: Commit**

```bash
git add src/lib/schema.sql src/lib/db.ts tests/experiences-schema.test.ts
git commit -m "feat: experiences table for resume material (schema v2)"
```

---

### Task 2: experiences 数据访问层

**Files:**
- Create: `src/resume/experiences.ts`
- Test: `tests/experiences-repo.test.ts`

- [ ] **Step 1: 写失败测试 tests/experiences-repo.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { createExperience, listExperiences, updateExperience, deleteExperience, ExperienceInput } from "@/resume/experiences";

const sample: ExperienceInput = {
  kind: "work",
  title: "SWE Intern",
  organization: "Acme",
  location: "SF",
  start_date: "2025-06",
  end_date: "2025-08",
  bullets: [{ text: "Built a service", directions: ["swe_backend"] }],
  sort_order: 0,
};

describe("experiences repo", () => {
  it("creates and lists", () => {
    const db = openDb(":memory:");
    const id = createExperience(db, sample);
    const all = listExperiences(db);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].bullets[0].text).toBe("Built a service");
  });
  it("validates kind and bullet shape", () => {
    const db = openDb(":memory:");
    expect(() => createExperience(db, { ...sample, kind: "nonsense" as any })).toThrow();
    expect(() => createExperience(db, { ...sample, bullets: [{ text: "", directions: ["swe_backend"] }] })).toThrow();
  });
  it("updates and deletes", () => {
    const db = openDb(":memory:");
    const id = createExperience(db, sample);
    updateExperience(db, id, { ...sample, title: "Senior SWE Intern" });
    expect(listExperiences(db)[0].title).toBe("Senior SWE Intern");
    deleteExperience(db, id);
    expect(listExperiences(db)).toHaveLength(0);
  });
  it("lists ordered by kind then sort_order", () => {
    const db = openDb(":memory:");
    createExperience(db, { ...sample, kind: "project", title: "P2", sort_order: 2 });
    createExperience(db, { ...sample, kind: "project", title: "P1", sort_order: 1 });
    const projects = listExperiences(db).filter((e) => e.kind === "project");
    expect(projects.map((p) => p.title)).toEqual(["P1", "P2"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/experiences-repo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 src/resume/experiences.ts**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/experiences-repo.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/resume/experiences.ts tests/experiences-repo.test.ts
git commit -m "feat: experiences data-access layer with zod validation"
```

---

### Task 3: LaTeX 渲染器(纯函数)

**Files:**
- Create: `src/resume/latex.ts`
- Test: `tests/resume-latex.test.ts`

- [ ] **Step 1: 写失败测试 tests/resume-latex.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { renderResumeLatex, escapeLatex, ResumeDoc } from "@/resume/latex";

const doc: ResumeDoc = {
  contact: { name: "Mengjia Shang", email: "m@example.com", phone: "+1-000", linkedin: "in/x", github: "gh/x" },
  sections: [
    {
      heading: "Education",
      entries: [{ title: "M.S. ECE", organization: "USC", location: "LA", dates: "2025–2027", bullets: ["Coursework: ML"] }],
    },
    {
      heading: "Experience",
      entries: [{ title: "SWE Intern", organization: "Acme & Co", location: "SF", dates: "2025", bullets: ["Built 50% faster pipeline", "Used C#"] }],
    },
  ],
};

describe("latex renderer", () => {
  it("escapes LaTeX special characters", () => {
    expect(escapeLatex("Acme & Co #1 50% $x_y")).toBe("Acme \\& Co \\#1 50\\% \\$x\\_y");
  });
  it("renders a compilable-looking document with all content", () => {
    const tex = renderResumeLatex(doc);
    expect(tex).toContain("\\documentclass");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
    expect(tex).toContain("Mengjia Shang");
    expect(tex).toContain("Acme \\& Co"); // escaped
    expect(tex).toContain("Built 50\\% faster pipeline"); // escaped
    expect(tex).toContain("Education");
    expect(tex).toContain("SWE Intern");
  });
  it("omits empty sections", () => {
    const tex = renderResumeLatex({ contact: doc.contact, sections: [{ heading: "Empty", entries: [] }] });
    expect(tex).not.toContain("Empty");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/resume-latex.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 src/resume/latex.ts**

```ts
export interface ResumeContact {
  name: string; email: string; phone: string; linkedin: string; github: string;
}
export interface ResumeEntry {
  title: string; organization?: string | null; location?: string | null; dates?: string | null; bullets: string[];
}
export interface ResumeSection {
  heading: string; entries: ResumeEntry[];
}
export interface ResumeDoc {
  contact: ResumeContact; sections: ResumeSection[];
}

// LaTeX special chars → escaped. Order matters: backslash first.
export function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

// Self-contained article-class resume. Kept deliberately simple so tectonic compiles it
// with zero external packages beyond the standard set.
export function renderResumeLatex(doc: ResumeDoc): string {
  const c = doc.contact;
  const header =
    `\\documentclass[10pt,letterpaper]{article}\n` +
    `\\usepackage[margin=0.5in]{geometry}\n` +
    `\\usepackage{enumitem}\n` +
    `\\usepackage[hidelinks]{hyperref}\n` +
    `\\setlist[itemize]{leftmargin=1.2em,itemsep=1pt,topsep=2pt}\n` +
    `\\pagestyle{empty}\n` +
    `\\begin{document}\n`;

  const contactBlock =
    `\\begin{center}\n` +
    `{\\Large \\textbf{${escapeLatex(c.name)}}}\\\\[2pt]\n` +
    `${escapeLatex(c.email)} $\\cdot$ ${escapeLatex(c.phone)} $\\cdot$ ${escapeLatex(c.linkedin)} $\\cdot$ ${escapeLatex(c.github)}\n` +
    `\\end{center}\n`;

  const body = doc.sections
    .filter((s) => s.entries.length > 0)
    .map((s) => {
      const entries = s.entries
        .map((e) => {
          const line1parts = [`\\textbf{${escapeLatex(e.title)}}`];
          if (e.organization) line1parts.push(escapeLatex(e.organization));
          const left = line1parts.join(", ");
          const right = [e.location, e.dates].filter(Boolean).map((x) => escapeLatex(x as string)).join(" $\\cdot$ ");
          const heading = right ? `${left} \\hfill ${right}\\\\` : `${left}\\\\`;
          const bullets = e.bullets.length
            ? `\\begin{itemize}\n${e.bullets.map((b) => `  \\item ${escapeLatex(b)}`).join("\n")}\n\\end{itemize}\n`
            : "";
          return `${heading}\n${bullets}`;
        })
        .join("\n\\vspace{2pt}\n");
      return `\\section*{${escapeLatex(s.heading)}}\n\\hrule\\vspace{4pt}\n${entries}`;
    })
    .join("\n\n");

  return `${header}${contactBlock}\n${body}\n\\end{document}\n`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/resume-latex.test.ts`
Expected: 3 passed

- [ ] **Step 5: 真实编译 smoke(tectonic 编出 PDF)**

Run:
```
npx tsx -e "import {renderResumeLatex} from './src/resume/latex'; import fs from 'fs'; import {execFileSync} from 'child_process'; const tex=renderResumeLatex({contact:{name:'Test User',email:'t@x.com',phone:'+1',linkedin:'in/t',github:'gh/t'},sections:[{heading:'Experience',entries:[{title:'SWE Intern',organization:'Acme & Co',location:'SF',dates:'2025',bullets:['Built 50% faster pipeline']}]}]}); fs.mkdirSync('/tmp/rtest',{recursive:true}); fs.writeFileSync('/tmp/rtest/r.tex',tex); execFileSync('tectonic',['/tmp/rtest/r.tex'],{stdio:'inherit'}); console.log('PDF exists:', fs.existsSync('/tmp/rtest/r.pdf'));"
```
Expected: `PDF exists: true`。若 tectonic 报 LaTeX 语法错:修 latex.ts 直到干净编译,记录到报告。

- [ ] **Step 6: Commit**

```bash
git add src/resume/latex.ts tests/resume-latex.test.ts
git commit -m "feat: latex resume renderer with escaping (tectonic-compilable)"
```

---

### Task 4: 生成引擎(Claude 选料 + 编译)

**Files:**
- Create: `src/resume/generate.ts`
- Test: `tests/resume-generate.test.ts`

- [ ] **Step 1: 写失败测试 tests/resume-generate.test.ts(注入 fake backend + fake compiler)**

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { createExperience } from "@/resume/experiences";
import { generateResume } from "@/resume/generate";
import { LlmBackend } from "@/llm/types";

function seed(db: ReturnType<typeof openDb>) {
  createExperience(db, { kind: "education", title: "M.S. ECE", organization: "USC", start_date: "2025", end_date: "2027", bullets: [], sort_order: 0 });
  createExperience(db, { kind: "project", title: "Distributed Trainer", organization: "USC", bullets: [{ text: "Sharded training across 8 GPUs", directions: ["ai_infra"] }, { text: "Wrote a React dashboard", directions: ["swe_general"] }], sort_order: 0 });
}

const contact = { name: "M S", email: "m@x.com", phone: "+1", linkedin: "in/x", github: "gh/x" };

// Fake backend returns a selection: keep the education entry and the ai_infra bullet only.
const fakeBackend = (selection: object): LlmBackend => ({
  name: "fake",
  complete: async () => ({ text: JSON.stringify(selection), backend: "fake" }),
});

describe("generateResume", () => {
  it("builds a ResumeDoc from the model's selection, compiles, and records a resume version", async () => {
    const db = openDb(":memory:");
    seed(db);
    const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
    const selection = {
      sections: [
        { heading: "Education", entry_ids: [exps[0].id] },
        { heading: "Projects", entries: [{ id: exps[1].id, bullets: ["Sharded training across 8 GPUs"] }] },
      ],
    };
    const compiled: { tex: string; pdfPath: string }[] = [];
    const fakeCompile = async (tex: string, outPath: string) => { compiled.push({ tex, pdfPath: outPath }); return outPath; };

    const res = await generateResume(db, {
      backend: fakeBackend(selection),
      contact,
      direction: "ai_infra",
      versionName: "ai_infra_v1",
      compile: fakeCompile,
      outDir: "/tmp/resumes-test",
    });

    expect(res.resumeId).toBeGreaterThan(0);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].tex).toContain("Sharded training across 8 GPUs");
    expect(compiled[0].tex).not.toContain("React dashboard"); // not selected
    const row = db.prepare("SELECT version_name, directions, pdf_path FROM resumes WHERE id=?").get(res.resumeId) as any;
    expect(row.version_name).toBe("ai_infra_v1");
    expect(JSON.parse(row.directions)).toContain("ai_infra");
  });

  it("throws a clear error if the model selects an experience id that does not exist", async () => {
    const db = openDb(":memory:");
    seed(db);
    const selection = { sections: [{ heading: "Projects", entries: [{ id: 9999, bullets: ["ghost"] }] }] };
    await expect(
      generateResume(db, { backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "v", compile: async (_t, o) => o, outDir: "/tmp/x" })
    ).rejects.toThrow(/unknown experience id|9999/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/resume-generate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 src/resume/generate.ts**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/resume-generate.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/resume/generate.ts tests/resume-generate.test.ts
git commit -m "feat: resume generation engine (claude selection -> latex -> compile -> version)"
```

---

### Task 5: tectonic 编译器封装

**Files:**
- Create: `src/resume/compile.ts`
- Test: `tests/resume-compile.test.ts`

- [ ] **Step 1: 写失败测试 tests/resume-compile.test.ts(注入 fake exec,不真编译)**

```ts
import { describe, it, expect } from "vitest";
import { makeTectonicCompiler } from "@/resume/compile";

describe("tectonic compiler wrapper", () => {
  it("invokes tectonic with the tex file and returns the pdf path", async () => {
    const calls: string[][] = [];
    const fakeExec = async (bin: string, args: string[]) => { calls.push([bin, ...args]); };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    const out = await compile("\\documentclass{article}\\begin{document}x\\end{document}", "/tmp/r/out.pdf");
    expect(out).toBe("/tmp/r/out.pdf");
    expect(calls[0][0]).toBe("tectonic");
    expect(calls[0].join(" ")).toMatch(/--outdir/);
  });
  it("throws with tectonic stderr on failure", async () => {
    const fakeExec = async () => { throw new Error("tectonic: undefined control sequence"); };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    await expect(compile("bad", "/tmp/r/out.pdf")).rejects.toThrow(/tectonic/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/resume-compile.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 src/resume/compile.ts**

```ts
import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import { Compiler } from "@/resume/generate";

export type Exec = (bin: string, args: string[]) => Promise<void>;

const defaultExec: Exec = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${stderr || (err as Error).message}`.slice(0, 500)));
      else resolve();
    });
  });

export interface TectonicOptions {
  bin?: string;
  exec?: Exec;
}

// tectonic compiles a .tex to a .pdf in an output dir. We write the tex to <outdir>/<name>.tex,
// run tectonic on it, and it emits <outdir>/<name>.pdf.
export function makeTectonicCompiler(opts: TectonicOptions = {}): Compiler {
  const bin = opts.bin ?? process.env.TECTONIC_BIN ?? "tectonic";
  const exec = opts.exec ?? defaultExec;
  return async (tex: string, outPdfPath: string): Promise<string> => {
    const outDir = path.dirname(outPdfPath);
    const base = path.basename(outPdfPath, ".pdf");
    const texPath = path.join(outDir, `${base}.tex`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(texPath, tex);
    await exec(bin, [texPath, "--outdir", outDir, "--keep-logs"]);
    return outPdfPath;
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/resume-compile.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/resume/compile.ts tests/resume-compile.test.ts
git commit -m "feat: tectonic compiler wrapper"
```

---

### Task 6: 经历 CRUD API

**Files:**
- Create: `src/app/api/experiences/route.ts`, `src/app/api/experiences/[id]/route.ts`
- Test: `tests/experiences-api.test.ts`(直接测 handler 逻辑或 repo 层已覆盖;这里做一个 handler 级 smoke)

- [ ] **Step 1: 写 src/app/api/experiences/route.ts(GET 列表 / POST 新建)**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listExperiences, createExperience, ExperienceInputSchema } from "@/resume/experiences";

export async function GET() {
  return NextResponse.json({ experiences: listExperiences(getDb()) });
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = ExperienceInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const id = createExperience(getDb(), parsed.data);
  return NextResponse.json({ id }, { status: 201 });
}
```

- [ ] **Step 2: 写 src/app/api/experiences/[id]/route.ts(PUT 更新 / DELETE 删除)**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { updateExperience, deleteExperience, ExperienceInputSchema } from "@/resume/experiences";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = ExperienceInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  updateExperience(getDb(), Number(id), parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteExperience(getDb(), Number(id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 写 handler smoke 测试 tests/experiences-api.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { ExperienceInputSchema } from "@/resume/experiences";

// The API handlers are thin wrappers over the repo (already tested). This locks the request
// contract: the schema rejects a bad payload and accepts a good one.
describe("experiences API contract", () => {
  it("accepts a valid create payload", () => {
    const r = ExperienceInputSchema.safeParse({ kind: "work", title: "X", bullets: [] });
    expect(r.success).toBe(true);
  });
  it("rejects an invalid kind", () => {
    const r = ExperienceInputSchema.safeParse({ kind: "bogus", title: "X" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 4: 跑测试 + 构建**

Run: `npx vitest run tests/experiences-api.test.ts && npm run build`
Expected: 通过,build 成功(路由编译)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/experiences tests/experiences-api.test.ts
git commit -m "feat: experiences CRUD API"
```

---

### Task 7: Profile 录入 UI

**Files:**
- Create: `src/app/profile/page.tsx`, `src/app/profile/experience-editor.tsx`
- Modify: `src/app/layout.tsx`(导航加"Profile")

- [ ] **Step 1: 写 src/app/profile/page.tsx(SSR 列出经历,客户端编辑器组件)**

```tsx
import { getDb } from "@/lib/db";
import { listExperiences } from "@/resume/experiences";
import { ExperienceEditor } from "./experience-editor";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const experiences = listExperiences(getDb());
  return (
    <div>
      <h1>Profile — 我的经历</h1>
      <p style={{ color: "#666", fontSize: 13, margin: "8px 0 16px" }}>
        像网申系统一样在这里录入你的教育、实习、项目、技能。生成简历时,Resume Studio 会按目标方向从这里挑选。
      </p>
      <ExperienceEditor initial={experiences} />
    </div>
  );
}
```

- [ ] **Step 2: 写 src/app/profile/experience-editor.tsx(客户端:增删改经历,每条含 bullets)**

```tsx
"use client";
import { useState } from "react";

interface Bullet { text: string; directions: string[] }
interface Exp {
  id?: number; kind: string; title: string; organization?: string | null; location?: string | null;
  start_date?: string | null; end_date?: string | null; bullets: Bullet[]; sort_order: number;
}
const KINDS = ["education", "work", "project", "skill", "award", "publication"];
const blank = (): Exp => ({ kind: "work", title: "", organization: "", location: "", start_date: "", end_date: "", bullets: [], sort_order: 0 });

export function ExperienceEditor({ initial }: { initial: Exp[] }) {
  const [items, setItems] = useState<Exp[]>(initial);
  const [draft, setDraft] = useState<Exp>(blank());
  const [msg, setMsg] = useState("");

  async function save(exp: Exp) {
    const isNew = !exp.id;
    const res = await fetch(isNew ? "/api/experiences" : `/api/experiences/${exp.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(exp),
    });
    if (!res.ok) { setMsg("保存失败:" + res.status); return; }
    setMsg("已保存");
    const list = await (await fetch("/api/experiences")).json();
    setItems(list.experiences);
    setDraft(blank());
  }
  async function remove(id: number) {
    await fetch(`/api/experiences/${id}`, { method: "DELETE" });
    setItems(items.filter((i) => i.id !== id));
  }
  function setDraftBullet(i: number, text: string) {
    const b = [...draft.bullets]; b[i] = { text, directions: b[i]?.directions ?? [] }; setDraft({ ...draft, bullets: b });
  }

  return (
    <div>
      <div style={{ background: "#fff", padding: 16, borderRadius: 8, marginBottom: 20 }}>
        <h3>添加一条经历</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="标题(职位/项目/学位)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="机构" value={draft.organization ?? ""} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} />
          <input placeholder="地点" value={draft.location ?? ""} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          <input placeholder="开始 (2025-06)" value={draft.start_date ?? ""} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
          <input placeholder="结束 (Present)" value={draft.end_date ?? ""} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} />
        </div>
        <div>
          {draft.bullets.map((b, i) => (
            <input key={i} style={{ width: "100%", margin: "3px 0" }} placeholder={`bullet ${i + 1}`} value={b.text} onChange={(e) => setDraftBullet(i, e.target.value)} />
          ))}
          <button onClick={() => setDraft({ ...draft, bullets: [...draft.bullets, { text: "", directions: [] }] })}>+ bullet</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => save(draft)} disabled={!draft.title}>保存经历</button> <span style={{ color: "#666" }}>{msg}</span>
        </div>
      </div>

      {KINDS.filter((k) => items.some((i) => i.kind === k)).map((k) => (
        <div key={k}>
          <h3 style={{ marginTop: 16, textTransform: "capitalize" }}>{k}</h3>
          {items.filter((i) => i.kind === k).map((e) => (
            <div key={e.id} style={{ background: "#fff", padding: 12, borderRadius: 6, marginBottom: 8 }}>
              <b>{e.title}</b> {e.organization && `· ${e.organization}`} {e.start_date && <span style={{ color: "#888" }}>({e.start_date}{e.end_date ? `–${e.end_date}` : ""})</span>}
              <button style={{ float: "right" }} onClick={() => remove(e.id!)}>删除</button>
              <ul style={{ margin: "6px 0 0 18px", fontSize: 13 }}>
                {e.bullets.map((b, i) => <li key={i}>{b.text}</li>)}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 导航加 Profile** — `src/app/layout.tsx` 的 `<nav>` 里加 `<a href="/profile">Profile</a>`

- [ ] **Step 4: 构建 + 测试** — `npm test && npm run build`。Expected: 全绿。

- [ ] **Step 5: 真实 UI 验收** — `npm run dev`;浏览器开 `/profile`,添加一条 work 经历(带 2 个 bullet),确认它出现在列表且刷新后仍在(POST 入库);删除它验证 DELETE。截图确认后 kill server。

- [ ] **Step 6: Commit**

```bash
git add src/app/profile src/app/layout.tsx
git commit -m "feat: profile experience-entry UI (user fills their own experiences)"
```

---

### Task 8: Resume Studio 生成 UI + API

**Files:**
- Create: `src/app/api/resumes/route.ts`, `src/app/api/resumes/generate/route.ts`, `src/app/api/resumes/[id]/pdf/route.ts`, `src/app/studio/page.tsx`, `src/app/studio/generate-panel.tsx`
- Modify: `src/app/layout.tsx`(导航加"Studio")

- [ ] **Step 1: 写 src/app/api/resumes/route.ts(列出已生成版本)**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const rows = getDb()
    .prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes ORDER BY compiled_at DESC")
    .all();
  return NextResponse.json({ resumes: rows });
}
```

- [ ] **Step 2: 写 src/app/api/resumes/generate/route.ts(触发生成一版)**

```ts
import { NextResponse } from "next/server";
import path from "path";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { getBackend } from "@/llm/registry";
import { generateResume } from "@/resume/generate";
import { makeTectonicCompiler } from "@/resume/compile";
import { isKnownDirection } from "@/matcher/directions";

export async function POST(req: Request) {
  const { direction, versionName } = await req.json();
  if (!isKnownDirection(direction)) return NextResponse.json({ error: "unknown direction" }, { status: 400 });
  const name = (versionName && String(versionName)) || `${direction}_${Date.now()}`;
  const p = loadProfile();
  try {
    const res = await generateResume(getDb(), {
      backend: getBackend(),
      contact: { name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin, github: p.github },
      direction,
      versionName: name,
      compile: makeTectonicCompiler(),
      outDir: path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "resumes"),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 3: 写 src/app/api/resumes/[id]/pdf/route.ts(返回 PDF 文件)**

```ts
import { getDb } from "@/lib/db";
import fs from "fs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare("SELECT pdf_path FROM resumes WHERE id=?").get(Number(id)) as { pdf_path: string } | undefined;
  if (!row || !row.pdf_path || !fs.existsSync(row.pdf_path)) return new Response("not found", { status: 404 });
  const buf = fs.readFileSync(row.pdf_path);
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf" } });
}
```

- [ ] **Step 4: 写 src/app/studio/page.tsx + generate-panel.tsx**

`page.tsx`:
```tsx
import { getDb } from "@/lib/db";
import { GeneratePanel } from "./generate-panel";

export const dynamic = "force-dynamic";

interface RRow { id: number; version_name: string; directions: string; pdf_path: string; compiled_at: string }

export default function StudioPage() {
  const rows = getDb().prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes ORDER BY compiled_at DESC").all() as RRow[];
  const expCount = (getDb().prepare("SELECT COUNT(*) n FROM experiences").get() as { n: number }).n;
  return (
    <div>
      <h1>Resume Studio</h1>
      {expCount === 0 && <p style={{ color: "#b00" }}>还没有经历。先去 Profile 页录入经历,再回来生成简历。</p>}
      <GeneratePanel />
      <h3 style={{ marginTop: 20 }}>已生成的简历版本</h3>
      <table>
        <thead><tr><th>版本</th><th>方向</th><th>生成时间</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.version_name}</td>
              <td>{JSON.parse(r.directions).join(", ")}</td>
              <td>{r.compiled_at}</td>
              <td><a href={`/api/resumes/${r.id}/pdf`} target="_blank" rel="noreferrer">查看 PDF</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`generate-panel.tsx`:
```tsx
"use client";
import { useState } from "react";

const DIRECTIONS = ["swe_general","swe_backend","ai_infra","mle","quant","embedded","systems_perf","robotics","sre_infra","data","security","gpu_cuda"];

export function GeneratePanel() {
  const [dir, setDir] = useState("swe_general");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function gen() {
    setBusy(true); setMsg("生成中(Claude 选料 + 编译,约 20-40 秒)…");
    try {
      const r = await fetch("/api/resumes/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction: dir, versionName: name || undefined }) });
      const j = await r.json();
      if (!r.ok) { setMsg("失败:" + (j.error || r.status)); return; }
      setMsg("完成!下方列表刷新查看");
      setTimeout(() => location.reload(), 1200);
    } catch (e) { setMsg("失败:" + e); } finally { setBusy(false); }
  }
  return (
    <div style={{ background: "#fff", padding: 16, borderRadius: 8, margin: "12px 0" }}>
      <h3>生成一版简历</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <select value={dir} onChange={(e) => setDir(e.target.value)}>{DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <input placeholder="版本名(可选)" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={gen} disabled={busy}>生成</button>
        <span style={{ color: "#666" }}>{msg}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 导航加 Studio** — `src/app/layout.tsx` 加 `<a href="/studio">Studio</a>`

- [ ] **Step 6: 构建 + 全量测试** — `npm test && npm run build && npx tsc --noEmit`。Expected: 全绿。

- [ ] **Step 7: 真实端到端验收(需要经历数据)** — `npm run dev`;先在 `/profile` 加 2-3 条经历(1 education + 2 project/work,每条带 bullets),再去 `/studio` 选 ai_infra 生成一版 → 等待 → 列表出现版本 → 点"查看 PDF"确认 PDF 能打开且内容来自你录入的经历。截图确认后 kill server。若生成失败,读错误(Claude 输出解析 / tectonic 编译)并修 generate.ts 或 latex.ts。

- [ ] **Step 8: Commit**

```bash
git add src/app/api/resumes src/app/studio src/app/layout.tsx
git commit -m "feat: resume studio UI — generate direction resumes from experiences"
```

---

### Task 9: 收尾 — README + 全量回归

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 加"Resume Studio"一节**

```markdown
## Resume Studio
在 /profile 页像填网申一样录入你的经历(教育/实习/项目/技能,每条带 bullets)。
在 /studio 选一个方向,Claude 从你的经历里挑选、组版,tectonic 编译出一版 PDF 简历。
生成多个方向版本进入简历库;后续申请执行时按岗位方向选最契合的版本。
经历内容全部由你在 UI 录入 —— 系统不导入外部文件。需要 tectonic(brew install tectonic)。
```

- [ ] **Step 2: 全量回归** — `npm test && npm run build && npx tsc --noEmit`。Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Resume Studio section"
```

---

## Self-Review 记录

- **Spec 覆盖**:对应 spec §5.1 更新版——经历经 UI 录入(不导入)、结构化素材库、Claude 选料生成、tectonic 编译、Studio 预览、定稿进简历库。§5.1 的"匹配引擎按方向选 resume 版本"在申请执行 plan(Plan 4)接入 `matches.resume_id`。
- **占位符扫描**:无 TBD;每步含完整代码。
- **类型一致性**:`ExperienceInput/Experience`(Task 2,4/6 用)、`ResumeDoc/ResumeContact/ResumeSection/ResumeEntry`(Task 3,4 用)、`Compiler`(Task 4 定义类型,5 实现)、`Selection/GenerateOptions/GenerateResult`(Task 4,8 用)、`makeTectonicCompiler`(Task 5,8 用)已核对一致。
- **安全**:经历文本经 `escapeLatex` 转义防 LaTeX 注入;生成 prompt 里经历是用户自己的数据(非抓取),但仍要求模型"不 fabricate、只复用/裁剪 bullet";PDF 路由只读库里登记的路径、存在性检查。tectonic 有 120s 超时。
- **不确定点(已兜底)**:Claude 选料输出格式可能需迭代——Task 8 Step 7 是真实端到端验收步骤,失败则修 generate.ts prompt / latex.ts;LaTeX 编译错误由 tectonic stderr 冒泡;所有单测注入 fake backend/compiler,不依赖真 LLM/tectonic。
