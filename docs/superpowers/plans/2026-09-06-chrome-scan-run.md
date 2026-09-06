# Chrome 扫描 run(值守会话找岗)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让值守会话(用户登录的 Chrome)按需去 LinkedIn / Handshake / Tesla 找岗,并通过入库接口进入与其他来源相同的流水线。

**Architecture:** 复用 executor_runs 的 user_chrome 排队机制:新增 kind `scan`(仅值守),App 提供 `POST /api/scan/ingest`(zod 校验 → `upsertJobs` → 接力)与 `GET /api/scan/known`(跳过已入库)。协议写进 skill 与 CLAUDE.md §3.12;会话只读,不点 Apply、不发消息。

**Tech Stack:** Next.js 15、better-sqlite3、zod、vitest。

**Spec:** `docs/superpowers/specs/2026-09-06-job-sources-design.md` §4

## Global Constraints

- 前置:计划一(服务器侧)已合入:`upsertJobs`、`startPostScanPipeline`、boards 里有 `chrome:linkedin` / `chrome:handshake` / `chrome:tesla` 三行(builtin)。
- `scan` run 只能 `user_chrome`;`headless` 返回 400。
- ingest 只接受 source ∈ {linkedin, handshake, tesla};applyUrl 必须 http(s);单次 ≤200 条。
- 会话在页面上只读;验证码 / "unusual activity" 立即停。

---

### Task 1: 执行器 kind `scan`

**Files:**
- Modify: `src/executor/runner.ts`(`ExecutorKind` 加 `"scan"`;`StartOptions` 加 `sites?: ("linkedin"|"handshake"|"tesla")[]; window?: "24h"|"7d"; maxPerSite?: number`;`startExecutor` 开头加 `if (channel === "headless" && kind === "scan") throw new Error("扫描 run 仅支持值守会话(user_chrome)")`;`buildPrompt` 加 `case "scan": throw new Error("scan runs are attended-only")`)
- Modify: `src/app/api/executor/start/route.ts`(`VALID_KINDS` 加 `"scan"`)
- Modify: `src/app/components/executor-panel.tsx`(`ExecutorKind` 加 `"scan"`;run 列表 kind 标签映射加 `scan: "Chrome 扫描"`——找到现有 kind → 中文标签的对象或三元,补一项)
- Test: `tests/executor-scan-kind.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// tests/executor-scan-kind.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";
import { startExecutor } from "@/executor/runner";
describe("scan executor kind", () => {
  it("refuses headless and enqueues a user_chrome row with options", () => {
    const db = openDb(":memory:");
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-run-"));
    expect(() => startExecutor(db, "scan", {}, { logDir }, "headless")).toThrow(/值守会话/);
    const r = startExecutor(db, "scan", { sites: ["linkedin"], window: "24h", maxPerSite: 20 }, { logDir }, "user_chrome");
    const row = db.prepare("SELECT kind, status, channel, options FROM executor_runs WHERE id = ?").get(r.id) as { kind: string; status: string; channel: string; options: string };
    expect(row).toMatchObject({ kind: "scan", status: "queued", channel: "user_chrome" });
    expect(JSON.parse(row.options)).toEqual({ sites: ["linkedin"], window: "24h", maxPerSite: 20 });
    expect(() => startExecutor(db, "scan", {}, { logDir }, "user_chrome")).toThrow(/already in progress/);
  });
});
```

- [ ] **Step 2: 确认失败** → **Step 3: 按 Files 改** → **Step 4: `npx vitest run tests/executor-scan-kind.test.ts tests/executor*.test.ts`** → **Step 5: Commit** `git commit -am "feat(executor): attended-only 'scan' run kind"`

---

### Task 2: 入库接口 + known 接口 + 来源页按钮

**Files:**
- Create: `src/scanner/ingest.ts`、`src/app/api/scan/ingest/route.ts`、`src/app/api/scan/known/route.ts`
- Modify: `src/app/sources/sources-board.tsx`(「Chrome 扫描」按钮)
- Test: `tests/ingest.test.ts`

**Interfaces:**
- `IngestJobSchema`(zod)、`IngestJob`、`chromeBoardKey(source): "chrome:linkedin"|"chrome:handshake"|"chrome:tesla"`、`ingestJobs(db, jobs: IngestJob[], opts?: {now?: Date}): UpsertSummary & { boards: string[] }`、`knownUrls(db, urls: string[]): string[]`。

- [ ] **Step 1: 失败测试**

```ts
// tests/ingest.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { IngestJobSchema, ingestJobs, knownUrls } from "@/scanner/ingest";
import { upsertBoards, getBoard } from "@/scanner/boards";
describe("ingest", () => {
  it("validates source/url", () => {
    expect(IngestJobSchema.safeParse({ company: "PayPal", title: "SWE New Grad", applyUrl: "https://www.linkedin.com/jobs/view/1/", source: "linkedin" }).success).toBe(true);
    expect(IngestJobSchema.safeParse({ company: "X", title: "SWE", applyUrl: "https://a.example/1", source: "greenhouse" }).success).toBe(false);
    expect(IngestJobSchema.safeParse({ company: "X", title: "SWE", applyUrl: "javascript:alert(1)", source: "tesla" }).success).toBe(false);
  });
  it("upserts with the chrome board key, stamps the board, reports known urls", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "chrome:linkedin", origin: "builtin" }]);
    const s = ingestJobs(db, [
      { company: "PayPal", title: "Software Engineer - Recent Graduate", location: "Chicago, IL", jdText: "jd", applyUrl: "https://www.linkedin.com/jobs/view/4463654152/", source: "linkedin", postedAt: "2026-09-04" },
      { company: "Tesla", title: "Firmware Engineer, New Grad", location: "Palo Alto, CA", jdText: "jd", applyUrl: "https://www.tesla.com/careers/search/job/x-1", source: "tesla", postedAt: null },
    ]);
    expect(s.inserted).toBe(2); expect(s.boards.sort()).toEqual(["chrome:linkedin", "chrome:tesla"]);
    expect(db.prepare("SELECT board_key FROM jobs WHERE company='PayPal'").get()).toEqual({ board_key: "linkedin:guest" }); // URL 解析优先:LinkedIn 职位页归 linkedin:guest
    expect(db.prepare("SELECT board_key, ats FROM jobs WHERE company='Tesla'").get()).toEqual({ board_key: "chrome:tesla", ats: "tesla" });
    expect(getBoard(db, "chrome:linkedin")!.last_ok_at).toBeTruthy();
    expect(knownUrls(db, ["https://www.linkedin.com/jobs/view/4463654152/", "https://nope.example/"])).toEqual(["https://www.linkedin.com/jobs/view/4463654152/"]);
  });
});
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// src/scanner/ingest.ts
import { z } from "zod";
import { DB } from "@/lib/db";
import { upsertJobs, UpsertSummary } from "@/scanner/upsert";
import { getBoard, iso, upsertBoards } from "@/scanner/boards";

export const IngestJobSchema = z.object({
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  location: z.string().max(300).nullable().optional(),
  jdText: z.string().max(40_000).default(""),
  applyUrl: z.string().url().refine((u) => /^https?:\/\//i.test(u), "http(s) only"),
  source: z.enum(["linkedin", "handshake", "tesla"]),
  postedAt: z.string().max(40).nullable().optional(),
  jobKind: z.enum(["intern", "newgrad"]).optional(),
});
export type IngestJob = z.infer<typeof IngestJobSchema>;
export const IngestBodySchema = z.object({ runId: z.number().int().optional(), jobs: z.array(IngestJobSchema).min(1).max(200) });

export const chromeBoardKey = (source: IngestJob["source"]) => `chrome:${source}` as const;

// 值守会话抄回来的岗位:走和其他来源一模一样的 upsert;chrome:* 板块盖 last_ok_at 让来源页看得到"上次跑"。
export function ingestJobs(db: DB, jobs: IngestJob[], opts: { now?: Date } = {}): UpsertSummary & { boards: string[] } {
  const now = opts.now ?? new Date();
  const boards = new Set<string>();
  const total: UpsertSummary = { inserted: 0, upgraded: 0, duplicates: 0, visaSkipped: 0, locSkipped: 0, errors: [] };
  for (const source of ["linkedin", "handshake", "tesla"] as const) {
    const rows = jobs.filter((j) => j.source === source);
    if (!rows.length) continue;
    const key = chromeBoardKey(source);
    boards.add(key);
    if (!getBoard(db, key)) upsertBoards(db, [{ key, origin: "builtin" }]);
    const s = upsertJobs(db, rows.map((j) => ({ company: j.company, title: j.title, location: j.location ?? null, jdText: j.jdText ?? "", applyUrl: j.applyUrl, source, ats: source === "tesla" ? "tesla" : null, postedAt: j.postedAt ?? null, jobKind: j.jobKind })), { boardKey: key });
    for (const k of ["inserted", "upgraded", "duplicates", "visaSkipped", "locSkipped"] as const) total[k] += s[k];
    total.errors.push(...s.errors);
    db.prepare("UPDATE boards SET last_polled_at=?, last_ok_at=?, last_error=NULL, updated_at=datetime('now') WHERE key=?").run(iso(now), iso(now), key);
  }
  return { ...total, boards: [...boards] };
}

export function knownUrls(db: DB, urls: string[]): string[] {
  const stmt = db.prepare("SELECT 1 FROM jobs WHERE apply_url = ?");
  return urls.filter((u) => !!stmt.get(u));
}
```
路由:`POST /api/scan/ingest`:`IngestBodySchema.safeParse(await req.json())` 失败 → 400 `{error}`;成功 → `const s = ingestJobs(db, jobs); if (s.inserted > 0) startPostScanPipeline(db); return json(s)`。`GET /api/scan/known?urls=a,b`(也接受 `POST {urls}`)→ `{ known }`。

sources-board.tsx:按钮「Chrome 扫描」→ `POST /api/executor/start {kind:"scan", channel:"user_chrome", options:{}}`;每 10s `GET /api/executor/status` 找 `kind==="scan"` 的 queued/running run,存在则按钮禁用并显示「排队中 / 运行中(run #id)」;完成后显示 summary。

- [ ] **Step 4: 运行通过;build** → **Step 5: Commit** `git commit -am "feat(scan): ingest and known endpoints for attended Chrome scan runs; /sources button"`

---

### Task 3: 值守协议文档

**Files:**
- Create: `.claude/skills/scan-executor/SKILL.md`
- Modify: `CLAUDE.md`(§3 加 12 条)、`README.md`

- [ ] **Step 1: SKILL.md**(结构照 network-executor:frontmatter name/description;§1 Preflight(App 可达 + Chrome 已连);§2 接单(claim-next kind=scan、options 默认 `{sites:["linkedin","handshake","tesla"], window:"24h", maxPerSite:40}`);§3 LinkedIn 流程(搜索 URL 模板、read_page 读卡片、`GET /api/scan/known` 过滤、详情页读正文与 Apply 按钮 href、不点 Apply、Easy Apply 记职位页);§4 Handshake(`https://usc.joinhandshake.com/stu/postings?…`);§5 Tesla(`https://www.tesla.com/careers/search/?query=<kw>&country=US`);§6 入库(每 10 条 `POST /api/scan/ingest`,记日志);§7 节流与停止条件(页面间隔 3–6s,每 run ≤150 页,验证码即停并 finish failed);§8 finish summary 格式)。
- [ ] **Step 2: CLAUDE.md §3.12**:

```
12. **Chrome 扫描 run(kind=scan,仅值守)**:来源页「Chrome 扫描」入队;接单后按 `.claude/skills/scan-executor/SKILL.md` 在用户 Chrome 里只读地搜 LinkedIn(登录态,按 12 方向各 2 组词,过去 24h,Entry level/Associate,美国)、Handshake(USC)、Tesla,读卡片 → `GET /api/scan/known?urls=` 过滤已入库 → 打开详情读正文与外链(不点 Apply;Easy Apply 记职位页)→ 每 10 条 `POST /api/scan/ingest {runId, jobs:[{company,title,location,jdText,applyUrl,source:'linkedin'|'handshake'|'tesla',postedAt}]}`。节流:页面间隔 3–6s,每 run ≤150 页;验证码/异常活动提示立即 finish failed。这些岗进同一条流水线;LinkedIn 来的岗 applyUrl 是 LinkedIn 职位页,投递时在 Chrome 里点 Apply 跳到公司页再照常填。
```
- [ ] **Step 3: README** 「自动扫描」末尾加「Chrome 扫描」小节。
- [ ] **Step 4: Commit** `git commit -am "docs: attended Chrome scan run protocol (skill + CLAUDE.md §3.12)"`

---

### Task 4: 合并与上线(两份计划共用)

- [ ] `npx vitest run` 全绿;`npm run build` 通过。
- [ ] 备份库:`mkdir -p /Users/moka/Documents/job_seeker/data/backups && cp /Users/moka/Documents/job_seeker/data/jobseeker.db /Users/moka/Documents/job_seeker/data/backups/jobseeker-2026-09-06-pre-sources.db`。
- [ ] 合入 main:在主检出 `/Users/moka/Documents/job_seeker` 执行 `git merge --ff-only claude/job-info-source-optimization-671684`(ff 不了就 `git merge --no-ff`)。
- [ ] 部署:`npm run build && launchctl kickstart -k gui/$(id -u)/com.jobseeker.os`;等 20s,`curl -s http://127.0.0.1:3000/api/sources | head -c 300` 确认 200;`sqlite3 data/jobseeker.db "pragma user_version"` = 12。
- [ ] 手动触发一次 `curl -s -X POST http://127.0.0.1:3000/api/scan/tick`,看 `boards>0`、`errors` 合理;`/sources` 页在浏览器面板打开截图。
- [ ] 导入目录:`curl -s -X POST http://127.0.0.1:3000/api/sources/import-directory`(或页面按钮),确认 `inserted` 约 4000+。
- [ ] 记忆更新(session-handoff、新建 job-sources 状态)。
