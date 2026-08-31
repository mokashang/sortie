# JobSeeker OS — Plan 1: 地基 + T1 扫描引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 JobSeeker OS 的可运行地基:Next.js+SQLite 应用、全量数据模型、profile 层、T1 自动扫描(GitHub 清单 + Greenhouse/Lever/Ashby API)、签证过滤、去重、定时调度、macOS+ntfy 通知、职位浏览页。

**Architecture:** Next.js 15(App Router,单进程,只绑 localhost)+ better-sqlite3。扫描引擎是纯 TS 模块,被 cron(instrumentation hook)和 API route 共同调用。一切个人信息住 `profile/`(gitignored),代码零硬编码。JD 文本一律视为不可信数据,只做解析与关键词标记,绝不当指令。

**Tech Stack:** Next.js 15, TypeScript, better-sqlite3, zod, yaml, node-cron, vitest。Spec: `docs/superpowers/specs/2026-08-30-jobseeker-os-design.md`

**约定(所有任务通用):**
- 仓库根 = `/Users/moka/Documents/job_seeker`,所有路径相对于它
- 测试命令一律 `npx vitest run <file>`;提交信息用 conventional commits
- 服务器数据库文件在 `data/`(gitignored);测试一律用 `new Database(':memory:')`,绝不碰真实库

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "jobseeker-os",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 3000",
    "build": "next build",
    "start": "next start -H 127.0.0.1 -p 3000",
    "test": "vitest run",
    "scan": "tsx scripts/scan.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "next": "^15.3.0",
    "node-cron": "^3.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "yaml": "^2.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "@types/react": "^19.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: 写 next.config.ts、vitest.config.ts、.gitignore、.env.example**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

`.gitignore`:
```
node_modules/
.next/
data/
profile/
!profile/profile.example.yaml
.env
*.tsbuildinfo
next-env.d.ts
```

`.env.example`:
```
# ntfy.sh 手机推送频道(自选一个长随机名,手机 ntfy app 订阅同名频道)
NTFY_TOPIC=
# 数据目录,默认 ./data
DATA_DIR=
```

- [ ] **Step 4: 写最小 App 壳**

`src/app/layout.tsx`:
```tsx
import "./globals.css";

export const metadata = { title: "JobSeeker OS" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <nav className="topnav">
          <a href="/">JobSeeker OS</a>
          <a href="/jobs">职位</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return <h1>JobSeeker OS</h1>;
}
```

`src/app/globals.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "PingFang SC", sans-serif; color: #1a1a2e; background: #f7f7fb; }
main { max-width: 1100px; margin: 0 auto; padding: 24px; }
.topnav { display: flex; gap: 20px; padding: 14px 24px; background: #1a1a2e; }
.topnav a { color: #eee; text-decoration: none; font-weight: 600; }
table { width: 100%; border-collapse: collapse; background: #fff; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e5ef; font-size: 14px; }
```

- [ ] **Step 5: 安装并验证构建**

Run: `npm install && npm run build`
Expected: build 成功,无 type error

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with vitest"
```

---

### Task 2: 数据库层(全量 schema)

**Files:**
- Create: `src/lib/schema.sql`, `src/lib/db.ts`
- Test: `tests/db.test.ts`

- [ ] **Step 1: 写 schema.sql(spec §3 全部 9 张表)**

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  jd_text TEXT,
  apply_url TEXT,
  source TEXT NOT NULL,            -- github_list | greenhouse | lever | ashby | linkedin | handshake | manual
  ats TEXT,                        -- greenhouse | lever | ashby | workday | other
  posted_at TEXT,
  job_kind TEXT NOT NULL DEFAULT 'newgrad',  -- newgrad | intern
  visa_flag TEXT,                  -- NULL | no_sponsor | citizen_only | clearance
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  direction TEXT,
  score INTEGER,
  tier INTEGER,
  resume_id INTEGER REFERENCES resumes(id),
  reason TEXT,
  skip_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'discovered',
  -- discovered|matched|prepared|awaiting_confirm|submitted|oa|interview|offer|rejected|stale|archived
  submitted_at TEXT,
  resume_id INTEGER REFERENCES resumes(id),
  form_screenshot TEXT,
  confirm_screenshot TEXT,
  referral_person_id INTEGER REFERENCES people(id),
  origin_outreach_id INTEGER REFERENCES outreach(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT,
  role_title TEXT,
  linkedin_url TEXT UNIQUE,
  email TEXT,
  email_status TEXT,               -- guessed | verified
  relation TEXT,                   -- recruiter | alum | hiring_manager | engineer
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  job_id INTEGER REFERENCES jobs(id),
  playbook TEXT NOT NULL,          -- referral|self_pitch|recruiter|coffee_chat|hidden_opportunity|followup|thanks
  channel TEXT NOT NULL,           -- linkedin | email
  draft TEXT,
  thread_log TEXT NOT NULL DEFAULT '[]',   -- JSON: [{at, dir: sent|received, text}]
  status TEXT NOT NULL DEFAULT 'draft',    -- draft|pending_send|sent|replied|meeting|referral_won|no_response
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  tier INTEGER NOT NULL DEFAULT 2,
  ats TEXT,                        -- greenhouse | lever | ashby | workday | other
  board_token TEXT,
  careers_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  probe_status TEXT,               -- ok | failed | untested
  directions TEXT NOT NULL DEFAULT '[]'    -- JSON array of direction slugs
);

CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_name TEXT NOT NULL UNIQUE,
  directions TEXT NOT NULL DEFAULT '[]',
  tex_path TEXT,
  pdf_path TEXT,
  compiled_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  payload TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, at);
```

- [ ] **Step 2: 写失败测试 tests/db.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { openDb, logEvent } from "@/lib/db";

describe("db", () => {
  it("creates all tables and inserts a job", () => {
    const db = openDb(":memory:");
    db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)"
    ).run("fp1", "Stripe", "SWE New Grad", "greenhouse");
    const row = db.prepare("SELECT company FROM jobs WHERE fingerprint=?").get("fp1") as { company: string };
    expect(row.company).toBe("Stripe");
  });

  it("rejects duplicate fingerprints", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)");
    ins.run("fp1", "A", "T", "s");
    expect(() => ins.run("fp1", "B", "T2", "s")).toThrow();
  });

  it("logs events", () => {
    const db = openDb(":memory:");
    logEvent(db, "scan_done", { entity: "scanner", payload: { inserted: 3 } });
    const row = db.prepare("SELECT kind, payload FROM events").get() as { kind: string; payload: string };
    expect(row.kind).toBe("scan_done");
    expect(JSON.parse(row.payload).inserted).toBe(3);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — cannot resolve `@/lib/db`

- [ ] **Step 4: 写 src/lib/db.ts**

```ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src/lib/schema.sql"), "utf8");

export type DB = Database.Database;

export function openDb(file?: string): DB {
  const dbFile =
    file ??
    path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "jobseeker.db");
  if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

let singleton: DB | null = null;
export function getDb(): DB {
  if (!singleton) singleton = openDb();
  return singleton;
}

export function logEvent(
  db: DB,
  kind: string,
  opts: { entity?: string; entityId?: number; payload?: unknown } = {}
): void {
  db.prepare("INSERT INTO events (kind, entity, entity_id, payload) VALUES (?,?,?,?)").run(
    kind,
    opts.entity ?? null,
    opts.entityId ?? null,
    JSON.stringify(opts.payload ?? {})
  );
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/db.test.ts`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.sql src/lib/db.ts tests/db.test.ts
git commit -m "feat: sqlite layer with full spec schema and event log"
```

---

### Task 3: Profile 层

**Files:**
- Create: `src/lib/profile.ts`, `profile/profile.example.yaml`, `profile/profile.yaml`(真实数据,gitignored)
- Test: `tests/profile.test.ts`

- [ ] **Step 1: 写 profile.example.yaml(泛化模板,入库示例)**

```yaml
# JobSeeker OS 用户档案 — 复制为 profile.yaml 并填入真实信息
name: ""
email: ""
phone: ""
linkedin: ""
github: ""
school: ""
degree: ""
grad_date: ""            # YYYY-MM
work_auth:
  status: ""             # 如 F-1 / citizen / H1B
  needs_sponsorship: true
targets:
  primary: newgrad       # newgrad | intern
  secondary: intern
directions:              # 方向 slug: 梯队
  swe_general: 1
daily_minutes_budget: 90
```

- [ ] **Step 2: 写失败测试 tests/profile.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { parseProfile } from "@/lib/profile";

const yamlText = `
name: Test User
email: t@example.com
phone: "+1-000-000-0000"
linkedin: linkedin.com/in/test
github: github.com/test
school: USC
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1
  needs_sponsorship: true
targets:
  primary: newgrad
  secondary: intern
directions:
  swe_general: 1
  ai_infra: 1
daily_minutes_budget: 90
`;

describe("profile", () => {
  it("parses a valid profile", () => {
    const p = parseProfile(yamlText);
    expect(p.name).toBe("Test User");
    expect(p.work_auth.needs_sponsorship).toBe(true);
    expect(p.directions.ai_infra).toBe(1);
  });

  it("rejects missing name", () => {
    expect(() => parseProfile("email: a@b.c")).toThrow();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/profile.test.ts`
Expected: FAIL — cannot resolve `@/lib/profile`

- [ ] **Step 4: 写 src/lib/profile.ts**

```ts
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/profile.test.ts`
Expected: 2 passed

- [ ] **Step 6: 写 Mengjia 的真实 profile/profile.yaml(gitignored,不入库)**

```yaml
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
  secondary: intern
directions:
  swe_general: 1
  swe_backend: 1
  ai_infra: 1
  mle: 1
  quant: 1
  embedded: 2
  systems_perf: 2
  robotics: 2
  sre_infra: 2
  data: 3
  security: 3
  gpu_cuda: 3
daily_minutes_budget: 90
```

- [ ] **Step 7: 验证真实 profile 可解析并 Commit**

Run: `npx tsx -e "import {loadProfile} from './src/lib/profile'; console.log(loadProfile().name)"`
Expected: `Mengjia Shang`

```bash
git add src/lib/profile.ts profile/profile.example.yaml tests/profile.test.ts
git commit -m "feat: profile layer with zod validation (personal data gitignored)"
```

---

### Task 4: 去重指纹 + 签证过滤

**Files:**
- Create: `src/scanner/fingerprint.ts`, `src/scanner/visa-filter.ts`
- Test: `tests/fingerprint.test.ts`, `tests/visa-filter.test.ts`

- [ ] **Step 1: 写失败测试 tests/fingerprint.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { fingerprint } from "@/scanner/fingerprint";

describe("fingerprint", () => {
  it("is stable across case/spacing/punctuation", () => {
    expect(fingerprint("Stripe, Inc.", "Software Engineer,  New Grad", "SF, CA")).toBe(
      fingerprint("stripe inc", "software engineer new grad", "sf ca")
    );
  });
  it("differs across companies", () => {
    expect(fingerprint("Stripe", "SWE", "SF")).not.toBe(fingerprint("Ramp", "SWE", "SF"));
  });
  it("tolerates missing location", () => {
    expect(fingerprint("A", "B", null)).toBe(fingerprint("A", "B", ""));
  });
});
```

- [ ] **Step 2: 写失败测试 tests/visa-filter.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { visaFlag } from "@/scanner/visa-filter";

describe("visaFlag", () => {
  it("flags explicit no-sponsorship", () => {
    expect(visaFlag("We are unable to sponsor visas for this role")).toBe("no_sponsor");
    expect(visaFlag("Will not sponsor employment visa now or in the future")).toBe("no_sponsor");
    expect(visaFlag("This position is not eligible for visa sponsorship")).toBe("no_sponsor");
  });
  it("flags citizen/green-card-only", () => {
    expect(visaFlag("Applicants must be U.S. citizens")).toBe("citizen_only");
    expect(visaFlag("US Citizenship or Green Card required")).toBe("citizen_only");
  });
  it("flags clearance requirements", () => {
    expect(visaFlag("Active TS/SCI security clearance required")).toBe("clearance");
  });
  it("returns null for silent or friendly JDs", () => {
    expect(visaFlag("We welcome candidates of all backgrounds")).toBeNull();
    expect(visaFlag("")).toBeNull();
    expect(visaFlag("Visa sponsorship available")).toBeNull();
    // 模糊表述不误杀(用户策略:只跳过明确拒绝)
    expect(visaFlag("Must be authorized to work in the US")).toBeNull();
  });
});
```

- [ ] **Step 3: 跑两个测试确认失败**

Run: `npx vitest run tests/fingerprint.test.ts tests/visa-filter.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: 写 src/scanner/fingerprint.ts**

```ts
import crypto from "crypto";

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|co)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function fingerprint(company: string, title: string, location: string | null | undefined): string {
  return crypto.createHash("sha256").update(`${norm(company)}|${norm(title)}|${norm(location)}`).digest("hex").slice(0, 24);
}
```

- [ ] **Step 5: 写 src/scanner/visa-filter.ts**

```ts
// 唯一允许关键词规则的环节(spec §4):黑白分明的签证硬过滤。
// 原则:只标记明确拒绝;模糊表述(如 "authorized to work")不误杀。
const NO_SPONSOR = [
  /unable to sponsor/i,
  /not (?:able|available) to sponsor/i,
  /cannot sponsor/i,
  /will not sponsor/i,
  /no (?:visa )?sponsorship/i,
  /sponsorship (?:is )?not (?:available|offered|provided)/i,
  /not eligible for (?:visa )?sponsorship/i,
  /without (?:the need for )?(?:visa )?sponsorship now and in the future/i,
];
const CITIZEN_ONLY = [
  /must be (?:a |an )?u\.?s\.? citizen/i,
  /u\.?s\.? citizen(?:ship)? (?:is )?(?:or green card )?required/i,
  /citizens? or (?:green card|permanent resident)s? only/i,
  /green card (?:holders? )?(?:or citizens? )?(?:is |are )?required/i,
];
const CLEARANCE = [/security clearance/i, /\bts\/sci\b/i, /(?:secret|top secret) clearance/i];

export type VisaFlag = "no_sponsor" | "citizen_only" | "clearance" | null;

export function visaFlag(jdText: string): VisaFlag {
  if (CLEARANCE.some((r) => r.test(jdText))) return "clearance";
  if (CITIZEN_ONLY.some((r) => r.test(jdText))) return "citizen_only";
  if (NO_SPONSOR.some((r) => r.test(jdText))) return "no_sponsor";
  return null;
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/fingerprint.test.ts tests/visa-filter.test.ts`
Expected: 7 passed

- [ ] **Step 7: Commit**

```bash
git add src/scanner/fingerprint.ts src/scanner/visa-filter.ts tests/fingerprint.test.ts tests/visa-filter.test.ts
git commit -m "feat: dedupe fingerprint and explicit-only visa filter"
```

---

### Task 5: 扫描源通用类型 + Greenhouse 源

**Files:**
- Create: `src/scanner/types.ts`, `src/scanner/sources/greenhouse.ts`, `tests/fixtures/greenhouse.json`
- Test: `tests/greenhouse.test.ts`

- [ ] **Step 1: 写 src/scanner/types.ts(所有源的统一输出契约)**

```ts
export interface RawJob {
  company: string;
  title: string;
  location: string | null;
  jdText: string;        // 纯文本 JD;抓不到则空串
  applyUrl: string;
  source: "github_list" | "greenhouse" | "lever" | "ashby";
  ats: string | null;
  postedAt: string | null; // ISO
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
```

- [ ] **Step 2: 写 fixture tests/fixtures/greenhouse.json(Greenhouse boards API 真实结构缩样)**

```json
{
  "jobs": [
    {
      "id": 101,
      "title": "Software Engineer, New Grad",
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/101",
      "updated_at": "2026-08-28T10:00:00-04:00",
      "location": { "name": "San Francisco, CA" },
      "content": "&lt;p&gt;Build systems. We are unable to sponsor visas.&lt;/p&gt;"
    },
    {
      "id": 102,
      "title": "Machine Learning Engineer, Early Career",
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/102",
      "updated_at": "2026-08-29T10:00:00-04:00",
      "location": { "name": "New York, NY" },
      "content": "&lt;p&gt;Train models at scale.&lt;/p&gt;"
    },
    {
      "id": 103,
      "title": "Senior Staff Engineer",
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/103",
      "updated_at": "2026-08-01T10:00:00-04:00",
      "location": { "name": "Remote" },
      "content": "&lt;p&gt;10+ years experience required.&lt;/p&gt;"
    }
  ]
}
```

- [ ] **Step 3: 写失败测试 tests/greenhouse.test.ts**

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchGreenhouse } from "@/scanner/sources/greenhouse";

const fixture = fs.readFileSync("tests/fixtures/greenhouse.json", "utf8");
const fakeFetch = async () =>
  new Response(fixture, { status: 200, headers: { "content-type": "application/json" } });

describe("greenhouse source", () => {
  it("maps jobs and decodes html entities, keeping only entry-level titles", async () => {
    const jobs = await fetchGreenhouse("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(2); // Senior Staff 被 entry-level 标题过滤器排除
    const swe = jobs.find((j) => j.title.includes("New Grad"))!;
    expect(swe.company).toBe("Acme");
    expect(swe.jdText).toContain("unable to sponsor");
    expect(swe.jdText).not.toContain("&lt;");
    expect(swe.source).toBe("greenhouse");
    expect(swe.applyUrl).toBe("https://boards.greenhouse.io/acme/jobs/101");
  });

  it("throws on non-200 (probe failure)", async () => {
    const notFound = async () => new Response("{}", { status: 404 });
    await expect(fetchGreenhouse("nope", "Nope", notFound)).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npx vitest run tests/greenhouse.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: 写 src/scanner/sources/greenhouse.ts + 共享的标题过滤/HTML清洗工具**

先建 `src/scanner/entry-level.ts`(Greenhouse/Lever/Ashby 三源共用):

```ts
// 标题级 entry-level 粗筛:排除明显的资深岗,减少下游 LLM 匹配的浪费。
// 宁可放过不可错杀 —— 不确定的留给匹配引擎判断。
const EXCLUDE = /\b(senior|staff|principal|director|manager|lead|sr\.?|vp|head of|distinguished|architect)\b/i;
const INTERN_HINT = /\b(intern|internship|co-?op)\b/i;

export function isEntryLevelTitle(title: string): boolean {
  return !EXCLUDE.test(title);
}
export function jobKindFromTitle(title: string): "intern" | "newgrad" {
  return INTERN_HINT.test(title) ? "intern" : "newgrad";
}
```

再建 `src/scanner/html.ts`:

```ts
export function htmlToText(html: string): string {
  return html
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}
```

然后 `src/scanner/sources/greenhouse.ts`:

```ts
import { RawJob, Fetcher } from "@/scanner/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface GhJob {
  title: string;
  absolute_url: string;
  updated_at: string;
  location: { name: string } | null;
  content?: string;
}

export async function fetchGreenhouse(
  boardToken: string,
  companyName: string,
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`greenhouse ${boardToken}: HTTP ${res.status}`);
  const data = (await res.json()) as { jobs: GhJob[] };
  return (data.jobs ?? [])
    .filter((j) => isEntryLevelTitle(j.title))
    .map((j) => ({
      company: companyName,
      title: j.title,
      location: j.location?.name ?? null,
      jdText: htmlToText(j.content ?? ""),
      applyUrl: j.absolute_url,
      source: "greenhouse" as const,
      ats: "greenhouse",
      postedAt: j.updated_at ?? null,
    }));
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/greenhouse.test.ts`
Expected: 2 passed

- [ ] **Step 7: Commit**

```bash
git add src/scanner/types.ts src/scanner/entry-level.ts src/scanner/html.ts src/scanner/sources/greenhouse.ts tests/fixtures/greenhouse.json tests/greenhouse.test.ts
git commit -m "feat: greenhouse source with entry-level title prefilter"
```

---

### Task 6: Lever 源

**Files:**
- Create: `src/scanner/sources/lever.ts`, `tests/fixtures/lever.json`
- Test: `tests/lever.test.ts`

- [ ] **Step 1: 写 fixture tests/fixtures/lever.json**

```json
[
  {
    "id": "ab1",
    "text": "Software Engineer - New Grad (2027)",
    "hostedUrl": "https://jobs.lever.co/acme/ab1",
    "createdAt": 1756400000000,
    "categories": { "location": "Palo Alto, CA", "team": "Engineering" },
    "descriptionPlain": "Ship code. Visa sponsorship available."
  },
  {
    "id": "ab2",
    "text": "Staff Software Engineer",
    "hostedUrl": "https://jobs.lever.co/acme/ab2",
    "createdAt": 1756400000000,
    "categories": { "location": "NYC" },
    "descriptionPlain": "10y+."
  }
]
```

- [ ] **Step 2: 写失败测试 tests/lever.test.ts**

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchLever } from "@/scanner/sources/lever";

const fixture = fs.readFileSync("tests/fixtures/lever.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("lever source", () => {
  it("maps postings, excludes staff-level, converts epoch to ISO", async () => {
    const jobs = await fetchLever("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toContain("New Grad");
    expect(jobs[0].location).toBe("Palo Alto, CA");
    expect(jobs[0].postedAt).toMatch(/^2026-/);
    expect(jobs[0].source).toBe("lever");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/lever.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 写 src/scanner/sources/lever.ts**

```ts
import { RawJob, Fetcher } from "@/scanner/types";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface LeverPosting {
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories?: { location?: string };
  descriptionPlain?: string;
}

export async function fetchLever(
  site: string,
  companyName: string,
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`lever ${site}: HTTP ${res.status}`);
  const data = (await res.json()) as LeverPosting[];
  return (data ?? [])
    .filter((p) => isEntryLevelTitle(p.text))
    .map((p) => ({
      company: companyName,
      title: p.text,
      location: p.categories?.location ?? null,
      jdText: p.descriptionPlain ?? "",
      applyUrl: p.hostedUrl,
      source: "lever" as const,
      ats: "lever",
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    }));
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/lever.test.ts`
Expected: 1 passed

- [ ] **Step 6: Commit**

```bash
git add src/scanner/sources/lever.ts tests/fixtures/lever.json tests/lever.test.ts
git commit -m "feat: lever source"
```

---

### Task 7: Ashby 源

**Files:**
- Create: `src/scanner/sources/ashby.ts`, `tests/fixtures/ashby.json`
- Test: `tests/ashby.test.ts`

- [ ] **Step 1: 写 fixture tests/fixtures/ashby.json**

```json
{
  "jobs": [
    {
      "title": "Software Engineer, New Grad",
      "location": "San Francisco",
      "jobUrl": "https://jobs.ashbyhq.com/acme/xyz",
      "publishedAt": "2026-08-29T00:00:00Z",
      "descriptionPlain": "Build the future.",
      "isListed": true
    },
    {
      "title": "Engineering Manager",
      "location": "Remote",
      "jobUrl": "https://jobs.ashbyhq.com/acme/mgr",
      "publishedAt": "2026-08-01T00:00:00Z",
      "descriptionPlain": "Manage.",
      "isListed": true
    }
  ]
}
```

- [ ] **Step 2: 写失败测试 tests/ashby.test.ts**

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchAshby } from "@/scanner/sources/ashby";

const fixture = fs.readFileSync("tests/fixtures/ashby.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("ashby source", () => {
  it("maps jobs and excludes manager titles", async () => {
    const jobs = await fetchAshby("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].applyUrl).toContain("ashbyhq.com");
    expect(jobs[0].source).toBe("ashby");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/ashby.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 写 src/scanner/sources/ashby.ts**

```ts
import { RawJob, Fetcher } from "@/scanner/types";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface AshbyJob {
  title: string;
  location?: string;
  jobUrl: string;
  publishedAt?: string;
  descriptionPlain?: string;
  isListed?: boolean;
}

export async function fetchAshby(
  boardName: string,
  companyName: string,
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}?includeCompensation=false`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`ashby ${boardName}: HTTP ${res.status}`);
  const data = (await res.json()) as { jobs: AshbyJob[] };
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false && isEntryLevelTitle(j.title))
    .map((j) => ({
      company: companyName,
      title: j.title,
      location: j.location ?? null,
      jdText: j.descriptionPlain ?? "",
      applyUrl: j.jobUrl,
      source: "ashby" as const,
      ats: "ashby",
      postedAt: j.publishedAt ?? null,
    }));
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/ashby.test.ts`
Expected: 1 passed

- [ ] **Step 6: Commit**

```bash
git add src/scanner/sources/ashby.ts tests/fixtures/ashby.json tests/ashby.test.ts
git commit -m "feat: ashby source"
```

---

### Task 8: GitHub 清单源(SimplifyJobs listings.json)

**Files:**
- Create: `src/scanner/sources/github-lists.ts`, `tests/fixtures/github-listings.json`
- Test: `tests/github-lists.test.ts`

- [ ] **Step 1: 写 fixture tests/fixtures/github-listings.json(SimplifyJobs listings.json 真实结构缩样)**

```json
[
  {
    "company_name": "Nimbus",
    "title": "Software Engineer I",
    "locations": ["Seattle, WA"],
    "url": "https://nimbus.example/apply",
    "active": true,
    "is_visible": true,
    "sponsorship": "Offers Sponsorship",
    "date_posted": 1756500000
  },
  {
    "company_name": "OldCo",
    "title": "SWE New Grad",
    "locations": ["Austin, TX"],
    "url": "https://oldco.example/apply",
    "active": false,
    "is_visible": true,
    "sponsorship": "Other",
    "date_posted": 1740000000
  },
  {
    "company_name": "Fortress",
    "title": "Junior Developer",
    "locations": ["DC"],
    "url": "https://fortress.example/apply",
    "active": true,
    "is_visible": true,
    "sponsorship": "Does Not Offer Sponsorship",
    "date_posted": 1756500000
  }
]
```

- [ ] **Step 2: 写失败测试 tests/github-lists.test.ts**

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchGithubList } from "@/scanner/sources/github-lists";

const fixture = fs.readFileSync("tests/fixtures/github-listings.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("github list source", () => {
  it("keeps active listings, maps sponsorship note into jdText marker", async () => {
    const jobs = await fetchGithubList("https://raw.example/listings.json", "newgrad", fakeFetch);
    expect(jobs).toHaveLength(2); // inactive 排除
    const fortress = jobs.find((j) => j.company === "Fortress")!;
    // 清单声明不 sponsor → 注入标记文本,让统一的 visaFlag 关键词过滤捕获
    expect(fortress.jdText).toContain("no visa sponsorship");
    const nimbus = jobs.find((j) => j.company === "Nimbus")!;
    expect(nimbus.jdText).not.toContain("no visa sponsorship");
    expect(nimbus.postedAt).toMatch(/^2026-/);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/github-lists.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 写 src/scanner/sources/github-lists.ts**

```ts
import { RawJob, Fetcher } from "@/scanner/types";

interface Listing {
  company_name: string;
  title: string;
  locations?: string[];
  url: string;
  active?: boolean;
  is_visible?: boolean;
  sponsorship?: string;
  date_posted?: number;
}

export async function fetchGithubList(
  rawUrl: string,
  _kind: "newgrad" | "intern",
  fetcher: Fetcher = fetch
): Promise<RawJob[]> {
  const res = await fetcher(rawUrl);
  if (!res.ok) throw new Error(`github list ${rawUrl}: HTTP ${res.status}`);
  const data = (await res.json()) as Listing[];
  return (data ?? [])
    .filter((l) => l.active !== false && l.is_visible !== false)
    .map((l) => ({
      company: l.company_name,
      title: l.title,
      location: l.locations?.join("; ") ?? null,
      jdText:
        l.sponsorship === "Does Not Offer Sponsorship"
          ? "[listing metadata] no visa sponsorship"
          : "",
      applyUrl: l.url,
      source: "github_list" as const,
      ats: null,
      postedAt: l.date_posted ? new Date(l.date_posted * 1000).toISOString() : null,
    }));
}

// 默认监控的清单(config 而非硬编码个人信息;Phase B 用户可换)
export const DEFAULT_LISTS: { url: string; kind: "newgrad" | "intern" }[] = [
  {
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    kind: "newgrad",
  },
  {
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
    kind: "intern",
  },
];
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/github-lists.test.ts`
Expected: 1 passed

- [ ] **Step 6: 联网冒烟验证清单 URL 真实可用(允许失败,失败则修 URL)**

Run: `npx tsx -e "import {fetchGithubList,DEFAULT_LISTS} from './src/scanner/sources/github-lists'; fetchGithubList(DEFAULT_LISTS[0].url,'newgrad').then(j=>console.log('newgrad listings:',j.length))"`
Expected: 打印数百条。若 404:去 github.com/SimplifyJobs/New-Grad-Positions 找 listings.json 实际路径(可能在默认分支根目录或 .github/scripts/ 下),更新 DEFAULT_LISTS 后重跑直到成功。Summer2027 清单同理(若该 repo 尚未建立,注释掉该条目并在 events 里记 warning,别让它阻塞)。

- [ ] **Step 7: Commit**

```bash
git add src/scanner/sources/github-lists.ts tests/fixtures/github-listings.json tests/github-lists.test.ts
git commit -m "feat: github simplify-lists source with sponsorship metadata mapping"
```

---

### Task 9: Watchlist 种子 + 加载器

**Files:**
- Create: `config/watchlist.seed.json`, `src/scanner/watchlist.ts`
- Test: `tests/watchlist.test.ts`

- [ ] **Step 1: 写 config/watchlist.seed.json(初始种子;board_token 未验证,由 Task 10 的扫描 probe 标记真伪;Plan 2 前用户在 UI 增删)**

```json
[
  { "name": "Anthropic",   "tier": 1, "ats": "greenhouse", "board_token": "anthropic",   "directions": ["ai_infra", "mle", "swe_general"] },
  { "name": "Stripe",      "tier": 1, "ats": "greenhouse", "board_token": "stripe",      "directions": ["swe_backend", "swe_general"] },
  { "name": "Databricks",  "tier": 1, "ats": "greenhouse", "board_token": "databricks",  "directions": ["ai_infra", "swe_backend"] },
  { "name": "Datadog",     "tier": 1, "ats": "greenhouse", "board_token": "datadog",     "directions": ["swe_backend", "sre_infra"] },
  { "name": "Cloudflare",  "tier": 1, "ats": "greenhouse", "board_token": "cloudflare",  "directions": ["systems_perf", "swe_backend"] },
  { "name": "Figma",       "tier": 1, "ats": "greenhouse", "board_token": "figma",       "directions": ["swe_general"] },
  { "name": "Coinbase",    "tier": 2, "ats": "greenhouse", "board_token": "coinbase",    "directions": ["swe_backend"] },
  { "name": "Robinhood",   "tier": 2, "ats": "greenhouse", "board_token": "robinhood",   "directions": ["swe_backend"] },
  { "name": "Pinterest",   "tier": 2, "ats": "greenhouse", "board_token": "pinterest",   "directions": ["swe_general", "mle"] },
  { "name": "Reddit",      "tier": 2, "ats": "greenhouse", "board_token": "reddit",      "directions": ["swe_general"] },
  { "name": "Roblox",      "tier": 2, "ats": "greenhouse", "board_token": "roblox",      "directions": ["swe_general", "systems_perf"] },
  { "name": "Samsara",     "tier": 2, "ats": "greenhouse", "board_token": "samsara",     "directions": ["swe_general", "embedded"] },
  { "name": "Duolingo",    "tier": 2, "ats": "greenhouse", "board_token": "duolingo",    "directions": ["swe_general", "mle"] },
  { "name": "Brex",        "tier": 2, "ats": "greenhouse", "board_token": "brex",        "directions": ["swe_backend"] },
  { "name": "Gusto",       "tier": 3, "ats": "greenhouse", "board_token": "gusto",       "directions": ["swe_general"] },
  { "name": "Scale AI",    "tier": 1, "ats": "greenhouse", "board_token": "scaleai",     "directions": ["ai_infra", "mle"] },
  { "name": "Citadel",     "tier": 1, "ats": "other",      "board_token": null,          "careers_url": "https://www.citadel.com/careers", "directions": ["quant", "swe_backend"] },
  { "name": "Hudson River Trading", "tier": 1, "ats": "greenhouse", "board_token": "wehrtyou", "directions": ["quant", "systems_perf"] },
  { "name": "Jump Trading", "tier": 1, "ats": "greenhouse", "board_token": "jumptrading", "directions": ["quant", "systems_perf"] },
  { "name": "Two Sigma",   "tier": 1, "ats": "other",      "board_token": null,          "careers_url": "https://careers.twosigma.com", "directions": ["quant", "mle"] },
  { "name": "DRW",         "tier": 1, "ats": "greenhouse", "board_token": "drweng",      "directions": ["quant"] },
  { "name": "IMC Trading", "tier": 1, "ats": "greenhouse", "board_token": "imc",         "directions": ["quant"] },
  { "name": "Palantir",    "tier": 1, "ats": "lever",      "board_token": "palantir",    "directions": ["swe_general", "swe_backend"] },
  { "name": "Voleon",      "tier": 2, "ats": "lever",      "board_token": "voleon",      "directions": ["quant", "mle"] },
  { "name": "OpenAI",      "tier": 1, "ats": "ashby",      "board_token": "openai",      "directions": ["ai_infra", "mle", "swe_general"] },
  { "name": "Ramp",        "tier": 1, "ats": "ashby",      "board_token": "ramp",        "directions": ["swe_backend"] },
  { "name": "Linear",      "tier": 2, "ats": "ashby",      "board_token": "linear",      "directions": ["swe_general"] },
  { "name": "Notion",      "tier": 1, "ats": "ashby",      "board_token": "notion",      "directions": ["swe_general"] },
  { "name": "Anysphere (Cursor)", "tier": 1, "ats": "ashby", "board_token": "cursor",    "directions": ["swe_general", "ai_infra"] },
  { "name": "Perplexity",  "tier": 1, "ats": "ashby",      "board_token": "perplexity", "directions": ["ai_infra", "mle"] },
  { "name": "NVIDIA",      "tier": 1, "ats": "workday",    "board_token": null,          "careers_url": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite", "directions": ["gpu_cuda", "ai_infra", "systems_perf"] },
  { "name": "Apple",       "tier": 1, "ats": "other",      "board_token": null,          "careers_url": "https://jobs.apple.com", "directions": ["embedded", "swe_general", "systems_perf"] },
  { "name": "Tesla",       "tier": 2, "ats": "other",      "board_token": null,          "careers_url": "https://www.tesla.com/careers", "directions": ["embedded", "robotics"] },
  { "name": "Waymo",       "tier": 2, "ats": "other",      "board_token": null,          "careers_url": "https://careers.withwaymo.com", "directions": ["robotics", "mle"] },
  { "name": "Jane Street", "tier": 1, "ats": "other",      "board_token": null,          "careers_url": "https://www.janestreet.com/join-jane-street/open-roles/", "directions": ["quant"] }
]
```

> **Post-implementation correction (quality review, 2026-08-30):** the initial real scan (Task
> 10 Step 6) probed all board_token guesses live and found 3 wrong. Citadel and Two Sigma have
> no working greenhouse/lever token under any guessed variant — reclassified `ats: "other"` with
> a `careers_url`, dropping them out of the pollable set until Plan 2's UI lets a user fix them.
> Perplexity's ashby board name is `perplexity`, not `perplexity-ai` (confirmed 200 + 97 live
> jobs). The seed above already reflects the corrected values.

- [ ] **Step 2: 写失败测试 tests/watchlist.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { syncWatchlist, getEnabledCompanies, setProbeStatus } from "@/scanner/watchlist";

const seed = [
  { name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: ["swe_general"] },
  { name: "NoApi", tier: 2, ats: "other", board_token: null, careers_url: "https://x.example", directions: ["quant"] },
];

describe("watchlist", () => {
  it("syncs seed into companies table, idempotently", () => {
    const db = openDb(":memory:");
    syncWatchlist(db, seed);
    syncWatchlist(db, seed); // 再跑一遍不重复
    const rows = db.prepare("SELECT COUNT(*) as n FROM companies").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("returns only enabled companies that have a pollable ats", () => {
    const db = openDb(":memory:");
    syncWatchlist(db, seed);
    const pollable = getEnabledCompanies(db, { pollableOnly: true });
    expect(pollable).toHaveLength(1);
    expect(pollable[0].name).toBe("Acme");
  });

  // Added post-implementation (quality review): DO NOTHING made reseeds a no-op, so a
  // corrected board_token in the seed file would never reach the DB on a re-run. DO UPDATE
  // fixes that, but must not clobber runtime state (enabled/probe_status) the seed doesn't own.
  it("reseeding updates mutable fields (e.g. board_token) but preserves enabled/probe_status", () => {
    const db = openDb(":memory:");
    syncWatchlist(db, seed);
    // simulate user/scan mutations that must survive a reseed
    const row = db.prepare("SELECT id FROM companies WHERE name='Acme'").get() as { id: number };
    setProbeStatus(db, row.id, "ok");
    db.prepare("UPDATE companies SET enabled=0 WHERE id=?").run(row.id);

    const updatedSeed = [
      { name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme2", directions: ["swe_general", "mle"] },
      { name: "NoApi", tier: 2, ats: "other", board_token: null, careers_url: "https://x.example", directions: ["quant"] },
    ];
    syncWatchlist(db, updatedSeed);

    const after = db
      .prepare("SELECT board_token, directions, enabled, probe_status FROM companies WHERE name='Acme'")
      .get() as { board_token: string; directions: string; enabled: number; probe_status: string };
    expect(after.board_token).toBe("acme2");
    expect(JSON.parse(after.directions)).toEqual(["swe_general", "mle"]);
    expect(after.enabled).toBe(0);
    expect(after.probe_status).toBe("ok");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/watchlist.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 写 src/scanner/watchlist.ts**

```ts
import { DB } from "@/lib/db";

export interface SeedCompany {
  name: string;
  tier: number;
  ats: string;
  board_token: string | null;
  careers_url?: string;
  directions: string[];
}

export interface CompanyRow {
  id: number;
  name: string;
  tier: number;
  ats: string | null;
  board_token: string | null;
  careers_url: string | null;
  enabled: number;
  probe_status: string | null;
  directions: string;
}

const POLLABLE = new Set(["greenhouse", "lever", "ashby"]);

// Reseeding updates the fields the seed file actually owns (tier/ats/board_token/careers_url/
// directions) so corrections to e.g. a wrong board_token take effect on the next sync — but
// deliberately leaves `enabled` and `probe_status` out of the SET clause, since those are
// runtime state owned by the user (enabled) and the scanner (probe_status), not the seed.
export function syncWatchlist(db: DB, seed: SeedCompany[]): void {
  const ins = db.prepare(
    `INSERT INTO companies (name, tier, ats, board_token, careers_url, probe_status, directions)
     VALUES (?,?,?,?,?, 'untested', ?)
     ON CONFLICT(name) DO UPDATE SET
       tier=excluded.tier,
       ats=excluded.ats,
       board_token=excluded.board_token,
       careers_url=excluded.careers_url,
       directions=excluded.directions`
  );
  const tx = db.transaction((rows: SeedCompany[]) => {
    for (const c of rows)
      ins.run(c.name, c.tier, c.ats, c.board_token, c.careers_url ?? null, JSON.stringify(c.directions));
  });
  tx(seed);
}

export function getEnabledCompanies(db: DB, opts: { pollableOnly?: boolean } = {}): CompanyRow[] {
  const rows = db.prepare("SELECT * FROM companies WHERE enabled=1").all() as CompanyRow[];
  return opts.pollableOnly
    ? rows.filter((r) => r.ats !== null && POLLABLE.has(r.ats) && r.board_token)
    : rows;
}

export function setProbeStatus(db: DB, companyId: number, status: "ok" | "failed"): void {
  db.prepare("UPDATE companies SET probe_status=? WHERE id=?").run(status, companyId);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/watchlist.test.ts`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add config/watchlist.seed.json src/scanner/watchlist.ts tests/watchlist.test.ts
git commit -m "feat: company watchlist seed and loader with probe status"
```

---

### Task 10: 扫描编排器(run)

**Files:**
- Create: `src/scanner/run.ts`, `scripts/scan.ts`
- Test: `tests/scan-run.test.ts`

- [ ] **Step 1: 写失败测试 tests/scan-run.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { syncWatchlist } from "@/scanner/watchlist";
import { runScan } from "@/scanner/run";
import { RawJob } from "@/scanner/types";

const job = (over: Partial<RawJob>): RawJob => ({
  company: "Acme",
  title: "SWE New Grad",
  location: "SF",
  jdText: "",
  applyUrl: "https://a.example",
  source: "greenhouse",
  ats: "greenhouse",
  postedAt: null,
  ...over,
});

describe("runScan", () => {
  it("inserts new jobs, dedupes, applies visa flag, logs summary, isolates source failure", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, [
      { name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: ["swe_general"] },
      { name: "Broken", tier: 2, ats: "greenhouse", board_token: "broken", directions: [] },
    ]);
    const sources = {
      greenhouse: async (token: string) => {
        if (token === "broken") throw new Error("HTTP 404");
        return [
          job({}),
          job({}), // 完全重复 → 去重
          job({ title: "SWE II", jdText: "unable to sponsor visas" }),
        ];
      },
      lever: async () => [] as RawJob[],
      ashby: async () => [] as RawJob[],
      githubLists: async () => [job({ company: "ListCo", source: "github_list", ats: null })],
    };
    const summary = await runScan(db, sources);
    expect(summary.inserted).toBe(3);
    expect(summary.upgraded).toBe(0);
    expect(summary.duplicates).toBe(1);
    expect(summary.sourceErrors).toHaveLength(1);
    expect(typeof summary.durationMs).toBe("number");
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    const flagged = db.prepare("SELECT visa_flag FROM jobs WHERE title='SWE II'").get() as { visa_flag: string };
    expect(flagged.visa_flag).toBe("no_sponsor");
    // 失败的公司 probe_status 标记为 failed
    const broken = db.prepare("SELECT probe_status FROM companies WHERE name='Broken'").get() as { probe_status: string };
    expect(broken.probe_status).toBe("failed");
    // 每个新 job 建 application 记录(status=discovered)
    const apps = db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number };
    expect(apps.n).toBe(3);
    // summary 事件写入 events
    const ev = db.prepare("SELECT COUNT(*) n FROM events WHERE kind='scan_done'").get() as { n: number };
    expect(ev.n).toBe(1);
  });

  // Added post-implementation (quality review — CRITICAL): the first real scan found that a
  // thin github_list row (jdText '' or just a sponsorship marker) landing after a richer ATS
  // row for the same job silently discarded the real JD and visa_flag — or, in the reverse
  // insert order, a thin row that landed first never got upgraded once the rich row showed up.
  // 63% of stored rows ended up with no JD text, hiding no_sponsor jobs. These two tests pin
  // both insert orders.
  it("upgrades a thin (empty/listing-metadata-only) record with a richer record's JD and visa flag when the rich one arrives later, without creating a second application", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, [{ name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: [] }]);
    const thin = job({
      company: "ListCo2",
      title: "SWE Upgrade Test",
      location: "Remote",
      jdText: "",
      applyUrl: "https://thin.example",
      source: "github_list",
      ats: null,
    });
    const rich = job({
      company: "ListCo2",
      title: "SWE Upgrade Test",
      location: "Remote",
      jdText: "unable to sponsor visas",
      applyUrl: "https://rich.example",
      source: "greenhouse",
      ats: "greenhouse",
    });

    const s1 = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [thin],
    });
    expect(s1.inserted).toBe(1);
    expect(s1.upgraded).toBe(0);

    const s2 = await runScan(db, {
      greenhouse: async (token: string) => (token === "acme" ? [rich] : []),
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [],
    });
    expect(s2.inserted).toBe(0);
    expect(s2.upgraded).toBe(1);
    expect(s2.duplicates).toBe(0);

    const row = db
      .prepare("SELECT jd_text, visa_flag, apply_url FROM jobs WHERE company='ListCo2'")
      .get() as { jd_text: string; visa_flag: string; apply_url: string };
    expect(row.jd_text).toBe("unable to sponsor visas");
    expect(row.visa_flag).toBe("no_sponsor");
    expect(row.apply_url).toBe("https://rich.example");

    const apps = db
      .prepare("SELECT COUNT(*) n FROM applications WHERE job_id = (SELECT id FROM jobs WHERE company='ListCo2')")
      .get() as { n: number };
    expect(apps.n).toBe(1);
  });

  it("does not let a later thin record downgrade an already-rich stored record (reverse insert order)", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, [{ name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: [] }]);
    const thin = job({
      company: "ListCo3",
      title: "SWE Downgrade Test",
      location: "Remote",
      jdText: "",
      applyUrl: "https://thin.example",
      source: "github_list",
      ats: null,
    });
    const rich = job({
      company: "ListCo3",
      title: "SWE Downgrade Test",
      location: "Remote",
      jdText: "unable to sponsor visas",
      applyUrl: "https://rich.example",
      source: "greenhouse",
      ats: "greenhouse",
    });

    const s1 = await runScan(db, {
      greenhouse: async (token: string) => (token === "acme" ? [rich] : []),
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [],
    });
    expect(s1.inserted).toBe(1);

    const s2 = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [thin],
    });
    expect(s2.inserted).toBe(0);
    expect(s2.upgraded).toBe(0);
    expect(s2.duplicates).toBe(1);

    const row = db
      .prepare("SELECT jd_text, visa_flag, apply_url FROM jobs WHERE company='ListCo3'")
      .get() as { jd_text: string; visa_flag: string; apply_url: string };
    expect(row.jd_text).toBe("unable to sponsor visas");
    expect(row.visa_flag).toBe("no_sponsor");
    expect(row.apply_url).toBe("https://rich.example");

    const apps = db
      .prepare("SELECT COUNT(*) n FROM applications WHERE job_id = (SELECT id FROM jobs WHERE company='ListCo3')")
      .get() as { n: number };
    expect(apps.n).toBe(1);
  });

  // Added post-implementation (quality review — IMPORTANT): the old bare `catch` treated every
  // insJob failure as a duplicate, masking real errors (e.g. a malformed source record that
  // violates NOT NULL). Only a genuine UNIQUE-constraint conflict should count as a duplicate.
  it("routes a non-unique-constraint insert failure (e.g. NOT NULL violation) to sourceErrors, not duplicates", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, []);
    const bad = { ...job({}), title: null } as unknown as RawJob;
    const s = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [bad],
    });
    expect(s.inserted).toBe(0);
    expect(s.upgraded).toBe(0);
    expect(s.duplicates).toBe(0);
    expect(s.sourceErrors.some((e) => e.source === "insert")).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/scan-run.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 src/scanner/run.ts**

```ts
import { DB, logEvent } from "@/lib/db";
import { RawJob } from "@/scanner/types";
import { fingerprint } from "@/scanner/fingerprint";
import { visaFlag } from "@/scanner/visa-filter";
import { jobKindFromTitle } from "@/scanner/entry-level";
import { getEnabledCompanies, setProbeStatus } from "@/scanner/watchlist";
import { fetchGreenhouse } from "@/scanner/sources/greenhouse";
import { fetchLever } from "@/scanner/sources/lever";
import { fetchAshby } from "@/scanner/sources/ashby";
import { fetchGithubList, DEFAULT_LISTS } from "@/scanner/sources/github-lists";

export interface ScanSources {
  greenhouse: (token: string, company: string) => Promise<RawJob[]>;
  lever: (token: string, company: string) => Promise<RawJob[]>;
  ashby: (token: string, company: string) => Promise<RawJob[]>;
  githubLists: () => Promise<RawJob[]>;
}

export interface ScanSummary {
  inserted: number;
  upgraded: number;
  duplicates: number;
  visaSkipped: number;
  sourceErrors: { source: string; error: string }[];
  durationMs: number;
}

const LIVE_SOURCES: ScanSources = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  githubLists: async () => {
    const all: RawJob[] = [];
    for (const l of DEFAULT_LISTS) all.push(...(await fetchGithubList(l.url, l.kind)));
    return all;
  },
};

export async function runScan(db: DB, sources: ScanSources = LIVE_SOURCES): Promise<ScanSummary> {
  const startedAt = Date.now();
  const summary: ScanSummary = {
    inserted: 0,
    upgraded: 0,
    duplicates: 0,
    visaSkipped: 0,
    sourceErrors: [],
    durationMs: 0,
  };
  const batches: RawJob[] = [];

  try {
    batches.push(...(await sources.githubLists()));
  } catch (e) {
    summary.sourceErrors.push({ source: "github_lists", error: String(e) });
  }

  for (const c of getEnabledCompanies(db, { pollableOnly: true })) {
    const fn = { greenhouse: sources.greenhouse, lever: sources.lever, ashby: sources.ashby }[
      c.ats as "greenhouse" | "lever" | "ashby"
    ];
    try {
      batches.push(...(await fn(c.board_token!, c.name)));
      setProbeStatus(db, c.id, "ok");
    } catch (e) {
      setProbeStatus(db, c.id, "failed");
      summary.sourceErrors.push({ source: `${c.ats}:${c.board_token}`, error: String(e) });
    }
  }

  const findByFp = db.prepare("SELECT id FROM jobs WHERE fingerprint = ?");
  // Upsert on fingerprint conflict, but only "win" the conflict (overwrite jd_text/visa_flag/
  // apply_url/source/ats) when the incoming row is richer than what's stored: the stored row
  // is still empty/listing-metadata-only AND the incoming row has real JD text. This fixes a
  // critical bug where a thin github_list row (jdText '' or just a sponsorship marker) landing
  // after a richer ATS row for the same job would silently discard the real JD and visa_flag —
  // or, depending on insert order, a thin row that inserted first would never get upgraded once
  // the rich ATS row showed up, since the old code treated every conflict as a no-op duplicate.
  // posted_at uses COALESCE so an upgrade never blanks out a posted date the stored row already had.
  const insJob = db.prepare(
    `INSERT INTO jobs (fingerprint, company, title, location, jd_text, apply_url, source, ats, posted_at, job_kind, visa_flag)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       jd_text=excluded.jd_text,
       visa_flag=excluded.visa_flag,
       apply_url=excluded.apply_url,
       source=excluded.source,
       ats=excluded.ats,
       posted_at=COALESCE(excluded.posted_at, jobs.posted_at)
     WHERE excluded.jd_text<>'' AND (jobs.jd_text='' OR jobs.jd_text LIKE '[listing metadata]%')`
  );
  const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");

  const tx = db.transaction((rows: RawJob[]) => {
    for (const r of rows) {
      const fp = fingerprint(r.company, r.title, r.location);
      const flag = visaFlag(r.jdText);
      // Pre-check whether this fingerprint already exists: with ON CONFLICT DO UPDATE, .run()
      // no longer throws on conflict (nor does .changes alone distinguish a fresh INSERT from
      // an UPDATE — both report changes=1), so this SELECT is the cleanest way to classify the
      // outcome as insert vs. upgrade vs. untouched-duplicate.
      const existing = findByFp.get(fp) as { id: number } | undefined;
      try {
        const info = insJob.run(
          fp, r.company, r.title, r.location, r.jdText, r.applyUrl,
          r.source, r.ats, r.postedAt, r.jobKind ?? jobKindFromTitle(r.title), flag
        );
        if (!existing) {
          // Brand-new job: create its application row. Never done for upgrades — the job id
          // (and its application) must stay stable across re-scans of the same fingerprint.
          insApp.run(info.lastInsertRowid);
          summary.inserted++;
          if (flag) summary.visaSkipped++;
        } else if (info.changes > 0) {
          summary.upgraded++;
        } else {
          summary.duplicates++; // conflict existed but WHERE didn't match = already-seen, no richer data
        }
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "SQLITE_CONSTRAINT_UNIQUE") {
          summary.duplicates++;
        } else {
          // Don't abort the whole batch (and don't rethrow) over one bad row — e.g. a NOT NULL
          // violation from a malformed source record. Isolate it and keep processing the rest.
          summary.sourceErrors.push({ source: "insert", error: String(e) });
        }
      }
    }
  });
  tx(batches);

  summary.durationMs = Date.now() - startedAt;
  logEvent(db, "scan_done", { entity: "scanner", payload: summary });
  return summary;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/scan-run.test.ts`
Expected: 4 passed

- [ ] **Step 5: 写 scripts/scan.ts(CLI 入口,cron 与手动共用)**

```ts
import { getDb } from "../src/lib/db";
import { syncWatchlist } from "../src/scanner/watchlist";
import { runScan } from "../src/scanner/run";
import seed from "../config/watchlist.seed.json";

async function main() {
  const db = getDb();
  syncWatchlist(db, seed);
  const s = await runScan(db);
  console.log(
    `scan done: +${s.inserted} new, ${s.upgraded} upgraded, ${s.duplicates} dup, ${s.visaSkipped} visa-flagged, ${s.sourceErrors.length} source errors (${s.durationMs}ms)`
  );
  for (const e of s.sourceErrors) console.error(`  [${e.source}] ${e.error}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

> **Post-implementation correction (quality review):** dropped the `as SeedCompany[]` cast — the
> JSON import already satisfies `SeedCompany[]` structurally with `resolveJsonModule` on — and
> added a `.catch` on `main()` so an unhandled rejection (e.g. every source failing) exits
> non-zero instead of silently swallowing the error.

- [ ] **Step 6: 联网真实跑一次全量扫描(同时充当 watchlist probe 验证)**

Run: `npm run scan`
Expected: 打印 `scan done: +N new ...`,N 为数百量级。source errors 里出现的 `greenhouse:xxx` 等即 board_token 猜错的公司——正常现象,probe_status 已标 failed,后续在 UI 修正;此处只需确认:(a) 命令不崩溃 (b) 至少 GitHub 清单和大部分 greenhouse token 成功。

- [ ] **Step 7: Commit**

```bash
git add src/scanner/run.ts scripts/scan.ts tests/scan-run.test.ts
git commit -m "feat: scan orchestrator with dedupe, visa flagging, source isolation"
```

- [ ] **Step 8 (post-implementation, quality review): rich-record upsert + reseed fix**

The first real scan (Step 6) surfaced a critical defect: 63% of stored rows ended up with no
JD text because a thin `github_list` row could win the `UNIQUE(fingerprint)` race against the
richer ATS row for the same job, silently discarding the real JD and `visa_flag` — hiding
`no_sponsor` jobs from the filter they exist to power. Fixed with the rich-record upgrade
upsert documented in Steps 1/3 above (`ON CONFLICT(fingerprint) DO UPDATE ... WHERE`), plus:
typed constraint handling in the same `catch` (only `SQLITE_CONSTRAINT_UNIQUE` counts as a
duplicate; anything else is isolated into `sourceErrors` rather than mis-counted or rethrown),
`syncWatchlist`'s `ON CONFLICT DO NOTHING` → `DO UPDATE` (Task 9) so a corrected `board_token`
in the seed file actually takes effect on reseed, and `scripts/scan.ts` cleanup. Also corrected
the 3 board_token guesses that failed probe in the first real scan (see the note under Task 9
Step 1) and re-ran `npm run scan` for real to confirm the upgrade path backfills JD text into
the previously-thin rows.

```bash
git add config/watchlist.seed.json scripts/scan.ts src/scanner/run.ts src/scanner/watchlist.ts \
  tests/scan-run.test.ts tests/watchlist.test.ts docs/superpowers/plans/2026-08-30-plan1-foundation-scanner.md
git commit -m "fix: rich-record upsert, typed constraint handling, watchlist reseed semantics"
```

---

### Task 11: 通知(macOS + ntfy)

**Files:**
- Create: `src/lib/notify.ts`
- Test: `tests/notify.test.ts`

- [ ] **Step 1: 写失败测试 tests/notify.test.ts**

```ts
import { describe, it, expect, vi } from "vitest";
import { notify } from "@/lib/notify";

describe("notify", () => {
  it("posts to ntfy when topic configured and calls macos notifier", async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("ok");
    };
    const fakeExec = vi.fn();
    await notify("标题", "正文内容", {
      ntfyTopic: "test-topic",
      fetcher: fakeFetch as typeof fetch,
      execMacNotifier: fakeExec,
    });
    expect(calls[0].url).toBe("https://ntfy.sh/test-topic");
    expect(calls[0].body).toBe("正文内容");
    expect(fakeExec).toHaveBeenCalledOnce();
  });

  it("skips ntfy silently when no topic", async () => {
    const fakeFetch = vi.fn();
    await notify("t", "b", { ntfyTopic: undefined, fetcher: fakeFetch, execMacNotifier: vi.fn() });
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/notify.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 src/lib/notify.ts**

```ts
import { execFile } from "child_process";

type MacNotifier = (title: string, body: string) => void;

const defaultMacNotifier: MacNotifier = (title, body) => {
  // osascript 弹系统通知;转义双引号防注入
  const esc = (s: string) => s.replace(/"/g, '\\"');
  execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
};

export async function notify(
  title: string,
  body: string,
  opts: {
    ntfyTopic?: string;
    priority?: "default" | "high";
    fetcher?: typeof fetch;
    execMacNotifier?: MacNotifier;
  } = {}
): Promise<void> {
  const topic = opts.ntfyTopic ?? process.env.NTFY_TOPIC;
  const fetcher = opts.fetcher ?? fetch;
  const mac = opts.execMacNotifier ?? defaultMacNotifier;

  mac(title, body);
  if (topic) {
    try {
      await fetcher(`https://ntfy.sh/${topic}`, {
        method: "POST",
        body,
        headers: { Title: encodeURIComponent(title), Priority: opts.priority === "high" ? "high" : "default" },
      });
    } catch {
      // 通知失败绝不阻塞流水线(spec §11.1)
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/notify.test.ts`
Expected: 2 passed

- [ ] **Step 5: 真实冒烟(本机弹一条通知)**

Run: `npx tsx -e "import {notify} from './src/lib/notify'; notify('JobSeeker OS','通知链路已打通')"`
Expected: Mac 右上角弹出通知(ntfy 部分静默跳过,因为 NTFY_TOPIC 未配;用户之后在 .env 配置并手机订阅)

- [ ] **Step 6: Commit**

```bash
git add src/lib/notify.ts tests/notify.test.ts
git commit -m "feat: dual-channel notifications (macos + ntfy), failure-tolerant"
```

---

### Task 12: 调度器 + API routes + 职位浏览页

**Files:**
- Create: `instrumentation.ts`, `src/app/api/scan/route.ts`, `src/app/api/jobs/route.ts`, `src/app/jobs/page.tsx`

- [ ] **Step 1: 写 instrumentation.ts(Next.js 启动时注册 cron,每天 7:00 / 13:00)**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const cron = (await import("node-cron")).default;
  const { getDb } = await import("@/lib/db");
  const { runScan } = await import("@/scanner/run");
  const { syncWatchlist } = await import("@/scanner/watchlist");
  const { notify } = await import("@/lib/notify");
  const seed = (await import("../config/watchlist.seed.json")).default;

  cron.schedule("0 7,13 * * *", async () => {
    try {
      const db = getDb();
      syncWatchlist(db, seed as never);
      const s = await runScan(db);
      if (s.inserted > 0) {
        await notify("JobSeeker OS 扫描完成", `新增 ${s.inserted} 个职位(${s.visaSkipped} 个签证不符已标记)`);
      }
    } catch (e) {
      console.error("[cron scan]", e);
    }
  });
  console.log("[jobseeker] cron registered: scan at 07:00 & 13:00");
}
```

- [ ] **Step 2: 写 src/app/api/scan/route.ts(UI 手动触发扫描)**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runScan } from "@/scanner/run";
import { syncWatchlist, SeedCompany } from "@/scanner/watchlist";
import seed from "../../../../config/watchlist.seed.json";

export async function POST() {
  const db = getDb();
  syncWatchlist(db, seed as SeedCompany[]);
  const summary = await runScan(db);
  return NextResponse.json(summary);
}
```

- [ ] **Step 3: 写 src/app/api/jobs/route.ts**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeVisaFlagged = url.searchParams.get("all") === "1";
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT id, company, title, location, source, job_kind, visa_flag, apply_url, posted_at, created_at
       FROM jobs ${includeVisaFlagged ? "" : "WHERE visa_flag IS NULL"}
       ORDER BY created_at DESC LIMIT 500`
    )
    .all();
  return NextResponse.json({ jobs });
}
```

- [ ] **Step 4: 写 src/app/jobs/page.tsx(服务端渲染职位表 + 手动扫描按钮)**

```tsx
import { getDb } from "@/lib/db";
import { ScanButton } from "./scan-button";

export const dynamic = "force-dynamic";

interface JobRow {
  id: number; company: string; title: string; location: string | null;
  source: string; job_kind: string; visa_flag: string | null;
  apply_url: string; created_at: string;
}

export default function JobsPage() {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT id, company, title, location, source, job_kind, visa_flag, apply_url, created_at
       FROM jobs WHERE visa_flag IS NULL ORDER BY created_at DESC LIMIT 200`
    )
    .all() as JobRow[];
  const total = (db.prepare("SELECT COUNT(*) n FROM jobs").get() as { n: number }).n;

  return (
    <div>
      <h1>职位 <small>({jobs.length} 显示 / {total} 总计)</small></h1>
      <ScanButton />
      <table>
        <thead>
          <tr><th>公司</th><th>标题</th><th>地点</th><th>类型</th><th>来源</th><th>入库时间</th><th></th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.company}</td>
              <td>{j.title}</td>
              <td>{j.location ?? "—"}</td>
              <td>{j.job_kind}</td>
              <td>{j.source}</td>
              <td>{j.created_at.slice(0, 16)}</td>
              <td><a href={j.apply_url} target="_blank" rel="noreferrer">原帖</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/app/jobs/scan-button.tsx`:
```tsx
"use client";
import { useState } from "react";

export function ScanButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function scan() {
    setBusy(true);
    setMsg("扫描中…");
    try {
      const r = await fetch("/api/scan", { method: "POST" });
      const s = await r.json();
      setMsg(`完成:+${s.inserted} 新职位,${s.duplicates} 重复,${s.sourceErrors.length} 源错误`);
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setMsg(`失败:${e}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <p style={{ margin: "12px 0" }}>
      <button onClick={scan} disabled={busy}>立即扫描</button> <span>{msg}</span>
    </p>
  );
}
```

- [ ] **Step 5: 全量测试 + 构建验证**

Run: `npm test && npm run build`
Expected: 所有测试通过,build 成功

- [ ] **Step 6: 启动 dev server 手动验收**

Run: `npm run dev`(后台)
验收:浏览器打开 `http://127.0.0.1:3000/jobs` → 能看到 Task 10 真实扫描入库的职位表;点"立即扫描"→ 显示汇总数字。终端日志出现 `cron registered`。

- [ ] **Step 7: Commit**

```bash
git add instrumentation.ts src/app scripts
git commit -m "feat: cron scheduler, scan/jobs API, jobs browse page"
```

---

### Task 13: 收尾 — README + 全量回归

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README.md**

```markdown
# JobSeeker OS

本地求职作战系统(Phase A:个人版)。spec 见 `docs/superpowers/specs/2026-08-30-jobseeker-os-design.md`。

## 启动
1. `npm install`
2. `cp profile/profile.example.yaml profile/profile.yaml` 并填写(已有真实档案则跳过)
3. `cp .env.example .env`,配置 `NTFY_TOPIC`(手机装 ntfy app 订阅同名频道)
4. `npm run dev` → http://127.0.0.1:3000

## 自动扫描
dev/start 进程内置 cron:每天 07:00 与 13:00 扫描 GitHub 清单 + watchlist 公司 ATS API。
手动:UI"立即扫描"按钮或 `npm run scan`。

## 数据
- SQLite:`data/jobseeker.db`(gitignored)
- 个人档案:`profile/profile.yaml`(gitignored)
- watchlist 种子:`config/watchlist.seed.json`

## 测试
`npm test`
```

- [ ] **Step 2: 全量回归**

Run: `npm test && npm run build`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README for plan 1 foundation"
```

---

## Self-Review 记录

- **Spec 覆盖**:本计划对应 spec §13 建设顺序第 1、2 步(骨架+数据模型+profile、T1 扫描+watchlist)及 §9 通知、§11 部分可靠性(源隔离、WAL)。§4 的 T2/T3 扫描、Workday CXS 探测、§5-§7 引擎、Dashboard、备份轮转属于 Plan 2-5,已在计划序列中排期
- **占位符扫描**:无 TBD/TODO;所有步骤含完整代码
- **类型一致性**:`RawJob`/`Fetcher`(Task 5 定义,6/7/8/10 使用)、`openDb/getDb/logEvent`(Task 2 定义,10/11/12 使用)、`SeedCompany/getEnabledCompanies/setProbeStatus`(Task 9 定义,10 使用)已核对一致
- **已知不确定点(设计上已兜底)**:watchlist 种子里的 board_token 与 SimplifyJobs listings.json 的 URL/字段名可能与线上有出入 —— Task 8 Step 6 与 Task 10 Step 6 是专门的联网验证步骤,probe 机制保证错 token 只标记不崩溃
```
