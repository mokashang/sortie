# 岗位信息源(服务器侧)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扫描的来源层从"2 份清单 + 28 家手工公司"重构为"boards 注册表 + 11 种适配器 + 按产出分级的每分钟调度器",队列按综合分排序并显示发布时间,扫描不再通知。

**Architecture:** `boards` 表是唯一的轮询驱动(种子 / URL 发现 / 目录导入三条进货渠道),`src/scanner/scheduler.ts` 每分钟挑到期板块,按 family 分组并发调用 `src/scanner/sources/<family>.ts` 适配器,统一经 `upsertJobs` 入库,再走现有 consolidate → match → referral-fit → jd_review 接力(抽到 `relay.ts`,匹配加每小时上限)。`retier.ts` 按 90 天产出升降级。

**Tech Stack:** Next.js 15、better-sqlite3、zod、vitest;无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-06-job-sources-design.md`

## Global Constraints

- schema v12;所有新列可空,迁移可重跑(列守卫 + `INSERT … ON CONFLICT`)。
- `jobs.source` 新值:workday / bytedance / smartrecruiters / oracle / icims / workable / amazon / linkedin / handshake / tesla。
- 现有 619 个测试必须保持全绿;新代码用 vitest,fixture 放 `tests/fixtures/sources/`(已从真实接口抓取)。
- 适配器只依赖注入的 `fetcher`,不读 DB;所有超时 `AbortSignal.timeout(20_000)`;失败 `throw new Error("<family> <ident>: HTTP <status>")`。
- 工程标题门只对 family ∈ {workday, smartrecruiters, oracle, icims, workable, linkedin, amazon} 及 origin ≠ seed 的 greenhouse/lever/ashby 生效;清单、bytedance、种子不设门。
- 扫描不发通知;`notify()` 只留给投递流程。
- 综合分 SQL:`(m.score - MIN(15, MAX(0, CAST((julianday('now') - COALESCE(julianday(j.posted_at), julianday('now','-35 days')) - 7) / 4 AS INTEGER))))`。
- 提交信息末尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/scanner/board-key.ts` | 从 apply_url 解析 `{family, ident, key, ats}`;`atsFromUrl` |
| `src/scanner/boards.ts` | boards 表读写:upsert / 种子同步 / URL 发现 / 到期挑选 / 结果回写 / 产出统计 |
| `src/scanner/retier.ts` | `computeTier` 纯函数、`retierAll`、`promoteRecentHighScores` |
| `src/scanner/upsert.ts` | `upsertJobs`(从 run.ts 抽出,加 board_key / ats) |
| `src/scanner/entry-level.ts` | 加 `isEngineeringTitle` |
| `src/scanner/sources/index.ts` | `FetchCtx` / `BoardFetcher` / `LIVE_REGISTRY` |
| `src/scanner/sources/{workday,bytedance,smartrecruiters,oracle,icims,workable,amazon,linkedin-guest,readme-table,directory}.ts` | 各适配器 |
| `src/scanner/sources/github-lists.ts` | 加 `fetchListBoard`(6 份清单、ETag) |
| `src/scanner/scheduler.ts` | `runTick` / `runSweep` |
| `src/scanner/relay.ts` | `startPostScanPipeline`、`matchBudget` |
| `src/scanner/run.ts` | `runScan` 变薄包装(核心 + 清单立刻问一遍) |
| `src/scanner/sources-view.ts` | /sources 页与 API 的查询函数 |
| `src/apply/rank.ts` | `COMPOSITE_SCORE_SQL`、`QUEUE_ORDER_SQL` |
| `config/boards.seed.json` | 种子(含内置聚合源、方向补缺公司) |
| `src/lib/schema.sql`、`src/lib/db.ts` | boards 表、jobs.board_key、v12 迁移 |
| `src/app/api/scan/tick/route.ts`、`src/app/api/scan/route.ts`、`src/instrumentation.ts` | 每分钟 tick、手动扫描 |
| `src/app/api/sources/{route,board/route,poll/route,import-directory/route}.ts` | 来源 API |
| `src/app/sources/{page,sources-board}.tsx`、`src/app/nav-links.tsx` | 来源页 |
| `src/app/queue/queue-board.tsx`、`src/app/api/queue/route.ts`、`src/apply/queue.ts` | 发布列 + 综合排序 |
| `scripts/import-directory.ts`、`scripts/retier.ts`、`package.json` | 运维脚本 |

---

### Task 1: URL → 板块解析器

**Files:**
- Create: `src/scanner/board-key.ts`
- Test: `tests/board-key.test.ts`

**Interfaces:**
- Produces: `type Family`, `FAMILIES: Family[]`, `interface ParsedBoard { family; ident; key; ats }`, `parseBoard(url): ParsedBoard | null`, `atsFromUrl(url): string | null`。后续所有任务用 `key = "<family>:<ident>"`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/board-key.test.ts
import { describe, it, expect } from "vitest";
import { parseBoard, atsFromUrl } from "@/scanner/board-key";

describe("parseBoard", () => {
  const cases: [string, string | null][] = [
    ["https://boards.greenhouse.io/stripe/jobs/8128744", "greenhouse:stripe"],
    ["https://job-boards.greenhouse.io/scaleai/jobs/4730836005", "greenhouse:scaleai"],
    ["https://boards.greenhouse.io/embed/job_app?for=Datadog&token=8052095", "greenhouse:datadog"],
    ["https://jobs.lever.co/palantir/e500bcf3-19d8-4d3c-b340-4d76e", "lever:palantir"],
    ["https://jobs.ashbyhq.com/openai/1234-5678", "ashby:openai"],
    ["https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/DFT_JR2016865", "workday:nvidia.wd5/NVIDIAExternalCareerSite"],
    ["https://bah.wd1.myworkdayjobs.com/en-US/BAH_Jobs/details/Software-Engineer_R0000", "workday:bah.wd1/BAH_Jobs"],
    ["https://rtx.wd5.myworkdaysite.com/recruiting/rtx/rec_rtx_ext_gateway/job/x/y", "workday:rtx.wd5/rec_rtx_ext_gateway"],
    ["https://jobs.smartrecruiters.com/ServiceNow/744000147650939-staff-engineer", "smartrecruiters:ServiceNow"],
    ["https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/26012889", "oracle:egug.fa.us2.oraclecloud.com/CX_1"],
    ["https://careers-sig.icims.com/jobs/11098/application-support-engineer/job", "icims:careers-sig.icims.com"],
    ["https://apply.workable.com/thorlabs/j/D406CD014E/", "workable:thorlabs"],
    ["https://lifeattiktok.com/search/7669691374918011141", "bytedance:tiktok"],
    ["https://jobs.bytedance.com/en/position/766969/detail", "bytedance:bytedance"],
    ["https://www.amazon.jobs/en/jobs/10530257/sde", "amazon:us"],
    ["https://www.linkedin.com/jobs/view/4463654152/", "linkedin:guest"],
    ["https://www.tesla.com/careers/search/job/x-123", "chrome:tesla"],
    ["https://usc.joinhandshake.com/stu/jobs/123", "chrome:handshake"],
    ["https://careers.roblox.com/jobs/8123?gh_jid=8123", null],           // 自定义域,token 未知
    ["https://nvidia.wd5.myworkdayjobs.com/", null],                        // 站点缺失
    ["not a url", null],
  ];
  for (const [url, key] of cases) it(`${url} → ${key}`, () => expect(parseBoard(url)?.key ?? null).toBe(key));

  it("normalizes greenhouse/lever/ashby idents to lowercase but keeps smartrecruiters/workday case", () => {
    expect(parseBoard("https://boards.greenhouse.io/Datadog/jobs/1")!.ident).toBe("datadog");
    expect(parseBoard("https://jobs.smartrecruiters.com/WesternDigital/1")!.ident).toBe("WesternDigital");
  });
});

describe("atsFromUrl", () => {
  it("returns the ats even when no board can be derived", () => {
    expect(atsFromUrl("https://careers.roblox.com/jobs/8123?gh_jid=8123")).toBe("greenhouse");
    expect(atsFromUrl("https://qualcomm.eightfold.ai/careers/job/446704474013")).toBe("eightfold");
    expect(atsFromUrl("https://jobs.l3harris.com/job/x")).toBeNull();
    expect(atsFromUrl("https://www.linkedin.com/jobs/view/1/")).toBeNull();
    expect(atsFromUrl("https://boards.greenhouse.io/stripe/jobs/1")).toBe("greenhouse");
  });
});
```

- [ ] **Step 2: 运行,确认失败**  Run: `npx vitest run tests/board-key.test.ts` → FAIL(module not found)

- [ ] **Step 3: 实现**

```ts
// src/scanner/board-key.ts
export type Family =
  | "greenhouse" | "lever" | "ashby" | "workday" | "bytedance" | "smartrecruiters" | "oracle"
  | "icims" | "workable" | "amazon" | "linkedin" | "github_list" | "chrome";

export const FAMILIES: Family[] = [
  "greenhouse", "lever", "ashby", "workday", "bytedance", "smartrecruiters", "oracle",
  "icims", "workable", "amazon", "linkedin", "github_list", "chrome",
];

export interface ParsedBoard { family: Family; ident: string; key: string; ats: string | null; }

const mk = (family: Family, ident: string, ats: string | null = family): ParsedBoard => ({ family, ident, key: `${family}:${ident}`, ats });

// 认得出 ATS 但本轮不轮询的主机:只回 ats,不建板块。
const ATS_ONLY: [RegExp, string][] = [
  [/(^|\.)eightfold\.ai$/, "eightfold"],
  [/successfactors|(^|\.)sap\.com$/, "successfactors"],
  [/(^|\.)taleo\.net$/, "taleo"],
  [/(^|\.)jobvite\.com$/, "jobvite"],
  [/(^|\.)bamboohr\.com$/, "bamboohr"],
  [/(^|\.)rippling\.com$/, "rippling"],
  [/(^|\.)recruitee\.com$/, "recruitee"],
  [/(^|\.)breezy\.hr$/, "breezy"],
];

export function parseBoard(url: string | null | undefined): ParsedBoard | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  let m: RegExpMatchArray | null;

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (segs[0] === "embed") { const t = u.searchParams.get("for"); return t ? mk("greenhouse", t.toLowerCase()) : null; }
    return segs[0] ? mk("greenhouse", segs[0].toLowerCase()) : null;
  }
  if (/(^|\.)lever\.co$/.test(host)) return segs[0] ? mk("lever", segs[0].toLowerCase()) : null;
  if (host === "jobs.ashbyhq.com") return segs[0] ? mk("ashby", segs[0].toLowerCase()) : null;
  if ((m = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/))) {
    const s = [...segs];
    if (s[0] && /^[a-z]{2}-[A-Za-z]{2}$/.test(s[0])) s.shift(); // /en-US/<site>/…
    if (!s[0] || ["job", "details", "jobs"].includes(s[0].toLowerCase())) return null;
    return mk("workday", `${m[1]}.${m[2]}/${s[0]}`);
  }
  if ((m = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdaysite\.com$/))) {
    return segs[0] === "recruiting" && segs[2] ? mk("workday", `${m[1]}.${m[2]}/${segs[2]}`) : null;
  }
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return segs[0] && segs[0] !== "job" ? mk("smartrecruiters", segs[0]) : null;
  if (/(^|\.)oraclecloud\.com$/.test(host)) {
    const i = segs.indexOf("sites");
    return i >= 0 && segs[i + 1] ? mk("oracle", `${host}/${segs[i + 1]}`) : null;
  }
  if (/(^|\.)icims\.com$/.test(host)) return mk("icims", host);
  if (host === "apply.workable.com") return segs[0] && segs[0] !== "j" ? mk("workable", segs[0].toLowerCase()) : null;
  if ((m = host.match(/^([a-z0-9-]+)\.workable\.com$/)) && !["www", "apply", "jobs"].includes(m[1])) return mk("workable", m[1]);
  if (/(^|\.)lifeattiktok\.com$/.test(host)) return mk("bytedance", "tiktok", "bytedance");
  if (/(^|\.)(bytedance|joinbytedance|toutiao)\.com$/.test(host)) return mk("bytedance", "bytedance", "bytedance");
  if (/(^|\.)amazon\.jobs$/.test(host)) return mk("amazon", "us", "amazon");
  if (/(^|\.)linkedin\.com$/.test(host) && segs[0] === "jobs") return mk("linkedin", "guest", null);
  if (/(^|\.)tesla\.com$/.test(host) && segs[0] === "careers") return mk("chrome", "tesla", "tesla");
  if (/(^|\.)joinhandshake\.com$/.test(host)) return mk("chrome", "handshake", null);
  return null;
}

export function atsFromUrl(url: string | null | undefined): string | null {
  const b = parseBoard(url);
  if (b) return b.ats;
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (u.searchParams.has("gh_jid") || /(^|\.)greenhouse\.io$/.test(host)) return "greenhouse";
  if (/myworkday(jobs|site)\.com$/.test(host)) return "workday";
  if (/(^|\.)oraclecloud\.com$/.test(host)) return "oracle";
  for (const [re, ats] of ATS_ONLY) if (re.test(host)) return ats;
  return null;
}
```

- [ ] **Step 4: 运行通过**  Run: `npx vitest run tests/board-key.test.ts` → PASS
- [ ] **Step 5: Commit**  `git add src/scanner/board-key.ts tests/board-key.test.ts && git commit -m "feat(scan): board-key parser — derive polling board and ATS family from any apply URL"`

---

### Task 2: schema v12 + boards 模块

**Files:**
- Modify: `src/lib/schema.sql`(jobs 加 `board_key TEXT`;新增 boards 表 + 索引)
- Modify: `src/lib/db.ts`(SCHEMA_VERSION=12;v11→v12 迁移)
- Create: `src/scanner/boards.ts`
- Test: `tests/boards.test.ts`、`tests/migration-v12.test.ts`

**Interfaces:**
- Produces: `type Tier = "core"|"longtail"|"dormant"|"muted"`, `type Origin`, `CADENCE_MS`, `interface BoardRow`, `interface BoardSpec`, `interface SeedEntry {key; company?; directions?; builtin?; meta?}`, `iso(d: Date): string`, `splitKey`, `upsertBoards(db, specs): {inserted, touched}`, `syncBoardsSeed(db, seed)`, `discoverBoardsFromJobs(db): number`, `getBoard(db, key)`, `dueBoards(db, {now, limit, families?, tiers?, keys?, localHour})`, `nextDueAfter(tier, failCount, now, rand?)`, `markBoardResult(db, key, {ok, error?, httpStatus?, now, rand?})`, `mergeBoardMeta(db, key, patch)`, `boardStats(db): Map<key, {ge75_90d, ge60_90d, jobs30, ge75_30}>`, `setBoardTier(db, key, tier)`。
- 迁移依赖 Task 1 的 `parseBoard`/`atsFromUrl` 与 Task 4 的 `retierAll`(迁移末尾调用;Task 4 之前先用 `discoverBoardsFromJobs` 即可,Task 4 完成后补一行)。

- [ ] **Step 1: schema.sql**  在 `CREATE TABLE IF NOT EXISTS jobs (…)` 的 `loc_flag TEXT` 后加 `, board_key TEXT`;在 executor_runs 表之后追加:

```sql
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,              -- family:ident
  family TEXT NOT NULL,
  ident TEXT NOT NULL,
  company TEXT,
  origin TEXT NOT NULL,                  -- seed | url | directory | builtin | manual
  tier TEXT NOT NULL DEFAULT 'longtail', -- core | longtail | dormant | muted
  tier_reason TEXT,
  tier_locked INTEGER NOT NULL DEFAULT 0,
  directions TEXT,
  meta TEXT,
  next_due_at TEXT,
  last_polled_at TEXT,
  last_ok_at TEXT,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boards_due ON boards(tier, next_due_at);
```

- [ ] **Step 2: 写失败测试(boards 模块)**

```ts
// tests/boards.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { upsertBoards, syncBoardsSeed, discoverBoardsFromJobs, dueBoards, markBoardResult, nextDueAfter, getBoard, boardStats, iso, setBoardTier } from "@/scanner/boards";

const NOW = new Date("2026-09-06T10:00:00Z");

describe("boards", () => {
  it("upserts, keeps user tier when locked, promotes seeds to core", () => {
    const db = openDb(":memory:");
    expect(upsertBoards(db, [{ key: "greenhouse:acme", company: "Acme", origin: "url" }])).toEqual({ inserted: 1, touched: 0 });
    expect(getBoard(db, "greenhouse:acme")!.tier).toBe("longtail");
    // 同一板块后来出现在种子里 → origin/tier 升为 seed/core,公司名不被覆盖为空
    syncBoardsSeed(db, [{ key: "greenhouse:acme", directions: ["swe_general"] }]);
    const b = getBoard(db, "greenhouse:acme")!;
    expect(b.origin).toBe("seed"); expect(b.tier).toBe("core"); expect(b.company).toBe("Acme");
    // 用户锁定的 tier 不被种子改
    setBoardTier(db, "greenhouse:acme", "muted");
    syncBoardsSeed(db, [{ key: "greenhouse:acme" }]);
    expect(getBoard(db, "greenhouse:acme")!.tier).toBe("muted");
  });

  it("discovers boards from jobs.board_key", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url, board_key) VALUES (?,?,?,?,?,?)").run("f1", "Zoox", "SWE", "github_list", "https://jobs.lever.co/zoox/1", "lever:zoox");
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url, board_key) VALUES (?,?,?,?,?,?)").run("f2", "Zoox", "SWE 2", "github_list", "https://jobs.lever.co/zoox/2", "lever:zoox");
    expect(discoverBoardsFromJobs(db)).toBe(1);
    const b = getBoard(db, "lever:zoox")!;
    expect(b.origin).toBe("url"); expect(b.company).toBe("Zoox"); expect(b.tier).toBe("longtail");
  });

  it("selects due boards in tier order, skipping muted/chrome and linkedin outside 8-22", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [
      { key: "greenhouse:a", origin: "url" },
      { key: "greenhouse:b", origin: "seed" },
      { key: "chrome:tesla", origin: "builtin" },
      { key: "linkedin:guest", origin: "builtin" },
      { key: "ashby:m", origin: "url", tier: "muted" },
    ]);
    db.prepare("UPDATE boards SET next_due_at = ? WHERE key = 'greenhouse:a'").run(iso(new Date(NOW.getTime() + 3600_000))); // 未到期
    const day = dueBoards(db, { now: NOW, limit: 10, localHour: 12 }).map((b) => b.key);
    expect(day).toEqual(["greenhouse:b", "linkedin:guest"]);
    const night = dueBoards(db, { now: NOW, limit: 10, localHour: 23 }).map((b) => b.key);
    expect(night).toEqual(["greenhouse:b"]);
    expect(dueBoards(db, { now: NOW, limit: 10, localHour: 12, keys: ["greenhouse:a"] })).toHaveLength(0);
  });

  it("writes poll results: cadence with jitter, exponential backoff, 429 → tomorrow, 404×5 → muted", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:a", origin: "seed" }, { key: "greenhouse:gone", origin: "url" }]);
    const rand = () => 0.5; // jitter = 1.0
    markBoardResult(db, "greenhouse:a", { ok: true, now: NOW, rand });
    let b = getBoard(db, "greenhouse:a")!;
    expect(b.next_due_at).toBe(iso(new Date(NOW.getTime() + 3600_000)));
    expect(b.last_ok_at).toBe(iso(NOW)); expect(b.fail_count).toBe(0);
    markBoardResult(db, "greenhouse:a", { ok: false, error: "greenhouse a: HTTP 500", httpStatus: 500, now: NOW, rand });
    b = getBoard(db, "greenhouse:a")!;
    expect(b.fail_count).toBe(1); expect(b.next_due_at).toBe(iso(new Date(NOW.getTime() + 2 * 3600_000)));
    markBoardResult(db, "greenhouse:a", { ok: false, error: "HTTP 429", httpStatus: 429, now: NOW, rand });
    expect(getBoard(db, "greenhouse:a")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 24 * 3600_000)));
    for (let i = 0; i < 5; i++) markBoardResult(db, "greenhouse:gone", { ok: false, error: "greenhouse gone: HTTP 404", httpStatus: 404, now: NOW, rand });
    b = getBoard(db, "greenhouse:gone")!;
    expect(b.tier).toBe("muted"); expect(b.tier_reason).toBe("404 x5");
    expect(db.prepare("SELECT COUNT(*) n FROM events WHERE kind='board_retier'").get()).toEqual({ n: 1 });
    // jitter 范围 ±10%
    const lo = nextDueAfter("core", 0, NOW, () => 0), hi = nextDueAfter("core", 0, NOW, () => 1);
    expect(lo).toBe(iso(new Date(NOW.getTime() + 3600_000 * 0.9)));
    expect(hi).toBe(iso(new Date(NOW.getTime() + 3600_000 * 1.1)));
    expect(nextDueAfter("muted", 0, NOW)).toBeNull();
  });

  it("aggregates yield stats per board from jobs × matches", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES (?,?,?,?,?)");
    ins.run("a", "Acme", "SWE 1", "greenhouse", "greenhouse:acme");
    ins.run("b", "Acme", "SWE 2", "greenhouse", "greenhouse:acme");
    ins.run("c", "Other", "SWE 3", "greenhouse", "greenhouse:other");
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 80), (2, 62), (3, 30)").run();
    const s = boardStats(db);
    expect(s.get("greenhouse:acme")).toMatchObject({ ge75_90d: 1, ge60_90d: 2, jobs30: 2, ge75_30: 1 });
    expect(s.get("greenhouse:other")).toMatchObject({ ge75_90d: 0, ge60_90d: 0, jobs30: 1 });
  });
});
```

- [ ] **Step 3: 写失败测试(迁移)**

```ts
// tests/migration-v12.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";

// 造一个 v11 形状的旧库:jobs 没有 board_key,user_version=11。
function makeV11(file: string) {
  const raw = new Database(file);
  raw.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE, company TEXT NOT NULL, title TEXT NOT NULL,
    location TEXT, jd_text TEXT, apply_url TEXT, source TEXT NOT NULL, ats TEXT, posted_at TEXT, job_kind TEXT NOT NULL DEFAULT 'newgrad', visa_flag TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), loc_flag TEXT, dedup_key TEXT, duplicate_of INTEGER, dedup_judged_at TEXT, sponsorship TEXT,
    degree_req TEXT, role_kind TEXT, elig_source TEXT, jd_status TEXT)`);
  raw.prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source, ats, dedup_key) VALUES (?,?,?,?,?,?,?)")
    .run("f1", "NVIDIA", "GPU Eng New Grad", "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/x_JR1", "github_list", null, "nvidia|gpu eng new grad");
  raw.prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source, ats, dedup_key) VALUES (?,?,?,?,?,?,?)")
    .run("f2", "Stripe", "SWE New Grad", "https://stripe.com/jobs/search?gh_jid=8128744", "github_list", null, "stripe|swe new grad");
  raw.pragma("user_version = 11");
  raw.close();
}

describe("v11 → v12 migration", () => {
  it("adds boards + jobs.board_key, backfills board_key/ats, discovers boards from URLs", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "v12-")), "db.sqlite");
    makeV11(file);
    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(12);
    const rows = db.prepare("SELECT title, board_key, ats FROM jobs ORDER BY id").all() as { title: string; board_key: string | null; ats: string | null }[];
    expect(rows[0]).toEqual({ title: "GPU Eng New Grad", board_key: "workday:nvidia.wd5/NVIDIAExternalCareerSite", ats: "workday" });
    expect(rows[1]).toEqual({ title: "SWE New Grad", board_key: null, ats: "greenhouse" });
    const board = db.prepare("SELECT origin, tier, company FROM boards WHERE key = ?").get("workday:nvidia.wd5/NVIDIAExternalCareerSite");
    expect(board).toMatchObject({ origin: "url", company: "NVIDIA" });
    // 可重跑
    db.close();
    const again = openDb(file);
    expect((again.prepare("SELECT COUNT(*) n FROM boards").get() as { n: number }).n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: 运行,确认失败**  Run: `npx vitest run tests/boards.test.ts tests/migration-v12.test.ts` → FAIL

- [ ] **Step 5: 实现 boards.ts**

```ts
// src/scanner/boards.ts
import { DB, logEvent } from "@/lib/db";
import { Family } from "@/scanner/board-key";

export type Tier = "core" | "longtail" | "dormant" | "muted";
export type Origin = "seed" | "url" | "directory" | "builtin" | "manual";
export const TIERS: Tier[] = ["core", "longtail", "dormant", "muted"];
export const CADENCE_MS: Record<Exclude<Tier, "muted">, number> = { core: 3600_000, longtail: 24 * 3600_000, dormant: 7 * 24 * 3600_000 };
export const MAX_404_STREAK = 5;

export interface BoardRow {
  id: number; key: string; family: Family; ident: string; company: string | null; origin: Origin; tier: Tier;
  tier_reason: string | null; tier_locked: number; directions: string | null; meta: string | null;
  next_due_at: string | null; last_polled_at: string | null; last_ok_at: string | null; last_error: string | null;
  fail_count: number; created_at: string; updated_at: string;
}
export interface BoardSpec { key: string; company?: string | null; origin: Origin; tier?: Tier; directions?: string[]; meta?: Record<string, unknown>; }
export interface SeedEntry { key: string; company?: string; directions?: string[]; builtin?: boolean; meta?: Record<string, unknown>; }

// sqlite datetime('now') 的格式(UTC,秒精度),所有 next_due_at/last_* 都用它,方便直接比较。
export const iso = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

export function splitKey(key: string): { family: Family; ident: string } {
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1) throw new Error(`bad board key '${key}'`);
  return { family: key.slice(0, i) as Family, ident: key.slice(i + 1) };
}

export function upsertBoards(db: DB, specs: BoardSpec[]): { inserted: number; touched: number } {
  const stmt = db.prepare(
    `INSERT INTO boards (key, family, ident, company, origin, tier, tier_reason, directions, meta)
     VALUES (@key, @family, @ident, @company, @origin, @tier, @tier_reason, @directions, @meta)
     ON CONFLICT(key) DO UPDATE SET
       company     = COALESCE(boards.company, excluded.company),
       directions  = COALESCE(boards.directions, excluded.directions),
       meta        = COALESCE(boards.meta, excluded.meta),
       origin      = CASE WHEN excluded.origin IN ('seed','builtin') THEN excluded.origin ELSE boards.origin END,
       tier_reason = CASE WHEN boards.tier_locked = 0 AND excluded.origin IN ('seed','builtin') AND boards.tier <> 'core' THEN 'seed' ELSE boards.tier_reason END,
       tier        = CASE WHEN boards.tier_locked = 1 THEN boards.tier
                          WHEN excluded.origin IN ('seed','builtin') THEN 'core'
                          ELSE boards.tier END,
       updated_at  = datetime('now')`
  );
  const exists = db.prepare("SELECT 1 FROM boards WHERE key = ?");
  let inserted = 0, touched = 0;
  db.transaction(() => {
    for (const s of specs) {
      const { family, ident } = splitKey(s.key);
      const had = !!exists.get(s.key);
      const seedy = s.origin === "seed" || s.origin === "builtin";
      stmt.run({
        key: s.key, family, ident, company: s.company ?? null, origin: s.origin,
        tier: s.tier ?? (seedy ? "core" : "longtail"), tier_reason: seedy ? "seed" : s.origin,
        directions: s.directions ? JSON.stringify(s.directions) : null, meta: s.meta ? JSON.stringify(s.meta) : null,
      });
      if (had) touched++; else inserted++;
    }
  })();
  return { inserted, touched };
}

export function syncBoardsSeed(db: DB, seed: SeedEntry[]): void {
  upsertBoards(db, seed.map((e) => ({ key: e.key, company: e.company ?? null, origin: e.builtin ? "builtin" : "seed", directions: e.directions, meta: e.meta })));
}

// 每个已入库岗位的 board_key 都是一个可轮询板块的证据:没见过的建成 longtail。
export function discoverBoardsFromJobs(db: DB): number {
  const rows = db.prepare("SELECT board_key AS key, MIN(company) AS company FROM jobs WHERE board_key IS NOT NULL GROUP BY board_key").all() as { key: string; company: string }[];
  return upsertBoards(db, rows.map((r) => ({ key: r.key, company: r.company, origin: "url" as const }))).inserted;
}

export function getBoard(db: DB, key: string): BoardRow | undefined {
  return db.prepare("SELECT * FROM boards WHERE key = ?").get(key) as BoardRow | undefined;
}

export interface DueOpts { now: Date; limit: number; families?: Family[]; tiers?: Tier[]; keys?: string[]; localHour: number; }
export function dueBoards(db: DB, o: DueOpts): BoardRow[] {
  const conds = ["tier <> 'muted'", "family <> 'chrome'", "(next_due_at IS NULL OR next_due_at <= ?)"];
  const params: unknown[] = [iso(o.now)];
  const inList = (col: string, vals?: string[]) => { if (vals?.length) { conds.push(`${col} IN (${vals.map(() => "?").join(",")})`); params.push(...vals); } };
  inList("family", o.families); inList("tier", o.tiers); inList("key", o.keys);
  if (o.localHour < 8 || o.localHour >= 22) conds.push("family <> 'linkedin'");
  params.push(o.limit);
  return db.prepare(
    `SELECT * FROM boards WHERE ${conds.join(" AND ")}
     ORDER BY CASE tier WHEN 'core' THEN 0 WHEN 'longtail' THEN 1 ELSE 2 END,
              CASE family WHEN 'github_list' THEN 0 ELSE 1 END,
              COALESCE(next_due_at, '') ASC, id ASC
     LIMIT ?`
  ).all(...params) as BoardRow[];
}

export function nextDueAfter(tier: Tier, failCount: number, now: Date, rand: () => number = Math.random): string | null {
  if (tier === "muted") return null;
  const jitter = 0.9 + rand() * 0.2;                       // ±10%
  const backoff = failCount > 0 ? 2 ** Math.min(failCount, 3) : 1;
  return iso(new Date(now.getTime() + CADENCE_MS[tier] * jitter * backoff));
}

export interface PollOutcome { ok: boolean; error?: string; httpStatus?: number | null; now: Date; rand?: () => number; }
export function markBoardResult(db: DB, key: string, o: PollOutcome): void {
  const b = getBoard(db, key);
  if (!b) return;
  const now = iso(o.now);
  if (o.ok) {
    db.prepare("UPDATE boards SET fail_count=0, last_polled_at=?, last_ok_at=?, last_error=NULL, next_due_at=?, updated_at=datetime('now') WHERE key=?")
      .run(now, now, nextDueAfter(b.tier, 0, o.now, o.rand), key);
    return;
  }
  const failCount = b.fail_count + 1;
  const is404 = o.httpStatus === 404 || /HTTP 404/.test(o.error ?? "");
  const streak404 = is404 && (b.fail_count === 0 || /HTTP 404/.test(b.last_error ?? ""));
  const mute = streak404 && failCount >= MAX_404_STREAK && b.tier_locked === 0 && b.tier !== "muted";
  const nextDue = mute ? null : o.httpStatus === 429 ? iso(new Date(o.now.getTime() + 24 * 3600_000)) : nextDueAfter(b.tier, failCount, o.now, o.rand);
  db.prepare("UPDATE boards SET fail_count=?, last_polled_at=?, last_error=?, next_due_at=?, tier=?, tier_reason=?, updated_at=datetime('now') WHERE key=?")
    .run(failCount, now, (o.error ?? "error").slice(0, 300), nextDue, mute ? "muted" : b.tier, mute ? `404 x${failCount}` : b.tier_reason, key);
  if (mute) logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key, from: b.tier, to: "muted", reason: `404 x${failCount}` } });
}

export function mergeBoardMeta(db: DB, key: string, patch: Record<string, unknown>): void {
  const b = getBoard(db, key);
  if (!b) return;
  let cur: Record<string, unknown> = {};
  try { cur = b.meta ? JSON.parse(b.meta) : {}; } catch { cur = {}; }
  db.prepare("UPDATE boards SET meta=?, updated_at=datetime('now') WHERE key=?").run(JSON.stringify({ ...cur, ...patch }), key);
}

export function setBoardTier(db: DB, key: string, tier: Tier): void {
  const b = getBoard(db, key);
  if (!b) throw new Error(`unknown board ${key}`);
  db.prepare("UPDATE boards SET tier=?, tier_reason='user', tier_locked=1, next_due_at=CASE WHEN ?='muted' THEN next_due_at ELSE NULL END, updated_at=datetime('now') WHERE key=?").run(tier, tier, key);
  logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key, from: b.tier, to: tier, reason: "user" } });
}

export interface BoardStats { ge75_90d: number; ge60_90d: number; jobs30: number; ge75_30: number; }
export function boardStats(db: DB): Map<string, BoardStats> {
  const rows = db.prepare(
    `SELECT j.board_key AS key,
       SUM(CASE WHEN m.score >= 75 AND j.created_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS ge75_90d,
       SUM(CASE WHEN m.score >= 60 AND j.created_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS ge60_90d,
       SUM(CASE WHEN j.created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS jobs30,
       SUM(CASE WHEN m.score >= 75 AND j.created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS ge75_30
     FROM jobs j LEFT JOIN matches m ON m.job_id = j.id
     WHERE j.board_key IS NOT NULL GROUP BY j.board_key`
  ).all() as (BoardStats & { key: string })[];
  return new Map(rows.map((r) => [r.key, { ge75_90d: r.ge75_90d, ge60_90d: r.ge60_90d, jobs30: r.jobs30, ge75_30: r.ge75_30 }]));
}
```

- [ ] **Step 6: db.ts 迁移**  `SCHEMA_VERSION = 12`;在 v10→v11 块后追加:

```ts
    // v11 -> v12: boards 注册表 + jobs.board_key(spec 2026-09-06 job-sources §1)。
    const jobCols12 = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    if (!jobCols12.includes("board_key")) db.exec("ALTER TABLE jobs ADD COLUMN board_key TEXT");
    const need = db.prepare("SELECT id, apply_url, ats FROM jobs WHERE board_key IS NULL AND apply_url IS NOT NULL").all() as { id: number; apply_url: string; ats: string | null }[];
    const upd12 = db.prepare("UPDATE jobs SET board_key = ?, ats = COALESCE(ats, ?) WHERE id = ?");
    db.transaction(() => { for (const r of need) { const b = parseBoard(r.apply_url); upd12.run(b?.key ?? null, r.ats ?? atsFromUrl(r.apply_url), r.id); } })();
    discoverBoardsFromJobs(db);
```
在文件顶部 `import { parseBoard, atsFromUrl } from "@/scanner/board-key"; import { discoverBoardsFromJobs } from "@/scanner/boards";`。在迁移块之后(与 idx_jobs_dedup_key 同处)加 `db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_board_key ON jobs(board_key)");`。(Task 4 完成后在 `discoverBoardsFromJobs(db)` 后追加 `retierAll(db)`。)

注意循环 import:`boards.ts` import `@/lib/db` 只为类型 `DB` 和 `logEvent`;`db.ts` import `boards.ts` 的函数——ESM 循环在函数调用时才解析,可行;若 vitest 报 undefined,改为 `db.ts` 里 `await import` 不可(同步),则把 `discoverBoardsFromJobs` 的 SQL 内联到 db.ts。

- [ ] **Step 7: 运行通过**  `npx vitest run tests/boards.test.ts tests/migration-v12.test.ts` → PASS;`npx vitest run` 全绿(旧测试不受影响)。
- [ ] **Step 8: Commit**  `git commit -am "feat(scan): boards registry table, schema v12 migration with board_key/ats backfill"`

---

### Task 3: `upsertJobs` 抽出 + board_key/ats 写入

**Files:**
- Create: `src/scanner/upsert.ts`
- Modify: `src/scanner/run.ts`(改用 upsertJobs;其余暂不动,Task 10 重写)
- Modify: `src/scanner/types.ts`(source 联合类型放宽)
- Test: `tests/upsert.test.ts`(把 `tests/scan-run.test.ts` 里三个 upsert 语义用例改写到这里;scan-run.test 在 Task 10 重写)

**Interfaces:**
- Produces: `interface UpsertSummary { inserted; upgraded; duplicates; visaSkipped; locSkipped; errors: {source; error}[] }`, `upsertJobs(db, rows: RawJob[], opts?: { boardKey?: string | null }): UpsertSummary`。

- [ ] **Step 1: types.ts**

```ts
export type JobSource =
  | "github_list" | "greenhouse" | "lever" | "ashby" | "workday" | "bytedance" | "smartrecruiters" | "oracle"
  | "icims" | "workable" | "amazon" | "linkedin" | "handshake" | "tesla";
export interface RawJob { company: string; title: string; location: string | null; jdText: string; applyUrl: string; source: JobSource; ats: string | null; postedAt: string | null; jobKind?: "intern" | "newgrad"; }
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
```

- [ ] **Step 2: 写失败测试**

```ts
// tests/upsert.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { upsertJobs } from "@/scanner/upsert";
import { RawJob } from "@/scanner/types";

const job = (o: Partial<RawJob>): RawJob => ({ company: "Acme", title: "SWE New Grad", location: "SF", jdText: "", applyUrl: "https://boards.greenhouse.io/acme/jobs/1", source: "greenhouse", ats: "greenhouse", postedAt: null, ...o });

describe("upsertJobs", () => {
  it("inserts, dedupes, flags visa/location, creates application rows", () => {
    const db = openDb(":memory:");
    const s = upsertJobs(db, [job({}), job({}), job({ title: "SWE II", jdText: "unable to sponsor visas" }), job({ title: "SWE London", location: "London, UK" })]);
    expect(s).toMatchObject({ inserted: 3, upgraded: 0, duplicates: 1, visaSkipped: 1, locSkipped: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number }).n).toBe(3);
  });

  it("writes board_key from the URL and falls back to opts.boardKey; fills ats from the URL", () => {
    const db = openDb(":memory:");
    upsertJobs(db, [
      job({ applyUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/x_JR1", source: "github_list", ats: null }),
      job({ title: "Other", applyUrl: "https://careers.example.com/jobs/1", source: "github_list", ats: null }),
    ], { boardKey: "github_list:simplify-newgrad" });
    const rows = db.prepare("SELECT title, board_key, ats FROM jobs ORDER BY id").all();
    expect(rows[0]).toEqual({ title: "SWE New Grad", board_key: "workday:nvidia.wd5/NVIDIAExternalCareerSite", ats: "workday" });
    expect(rows[1]).toEqual({ title: "Other", board_key: "github_list:simplify-newgrad", ats: null });
  });

  it("upgrades a thin row with a richer record without creating a second application", () => {
    const db = openDb(":memory:");
    upsertJobs(db, [job({ jdText: "[listing metadata] no visa sponsorship", source: "github_list", ats: null })]);
    const s = upsertJobs(db, [job({ jdText: "Full JD text here. We sponsor visas." })]);
    expect(s).toMatchObject({ inserted: 0, upgraded: 1 });
    const row = db.prepare("SELECT jd_text, source, visa_flag FROM jobs").get() as { jd_text: string; source: string; visa_flag: string | null };
    expect(row.source).toBe("greenhouse"); expect(row.jd_text).toContain("Full JD");
    expect((db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number }).n).toBe(1);
  });
});
```

- [ ] **Step 3: 实现**  把 `run.ts` 里 `findByFp` / `insJob` / `insApp` / 事务整段搬到 `upsert.ts`,INSERT 列表加 `board_key`(值 `parseBoard(r.applyUrl)?.key ?? opts.boardKey ?? null`),`ats` 用 `r.ats ?? atsFromUrl(r.applyUrl)`,summary 字段名 `errors`。`run.ts` 的 `runScan` 改为收集 batches 后 `const s = upsertJobs(db, batches); summary.inserted = s.inserted; …; summary.sourceErrors.push(...s.errors)`。
- [ ] **Step 4: 运行**  `npx vitest run tests/upsert.test.ts tests/scan-run.test.ts` → PASS
- [ ] **Step 5: Commit**  `git commit -am "refactor(scan): extract upsertJobs, stamp board_key and ats on insert"`

---

### Task 4: 工程标题门 + retier

**Files:**
- Modify: `src/scanner/entry-level.ts`
- Create: `src/scanner/retier.ts`
- Modify: `src/lib/db.ts`(迁移末尾 `retierAll(db)`)
- Test: `tests/entry-level.test.ts`(追加)、`tests/retier.test.ts`

**Interfaces:**
- Produces: `isEngineeringTitle(title): boolean`;`computeTier(i: RetierInput): {tier, reason} | null`;`retierAll(db, now?): {changed}`;`promoteRecentHighScores(db, sinceIso): number`。

- [ ] **Step 1: 失败测试**

```ts
// 追加到 tests/entry-level.test.ts
import { isEngineeringTitle } from "@/scanner/entry-level";
describe("isEngineeringTitle", () => {
  it("passes engineering-ish titles and rejects retail/ops noise", () => {
    for (const t of ["Software Engineer", "Firmware Engineer II", "Quantitative Researcher", "Data Scientist", "GPU Kernel Developer", "Security Analyst", "Robotics Perception Intern", "Machine Learning Engineer", "SRE", "Technical Program Manager"])
      expect(isEngineeringTitle(t), t).toBe(true);
    for (const t of ["Fulfillment Associate", "Tax Intern", "Sales & Operations Advisor in Training", "Registered Nurse", "Store Manager", "Marketing Coordinator"])
      expect(isEngineeringTitle(t), t).toBe(false);
  });
});
```

```ts
// tests/retier.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { computeTier, retierAll, promoteRecentHighScores } from "@/scanner/retier";
import { upsertBoards, getBoard, iso } from "@/scanner/boards";

const base = { origin: "url" as const, tier: "longtail" as const, tier_locked: 0, ge75_90d: 0, ge60_90d: 0, polledDays: 0 };
describe("computeTier", () => {
  it("promotes on yield, demotes idle core, sleeps idle longtail, wakes dormant, respects lock/seed/muted", () => {
    expect(computeTier({ ...base, ge75_90d: 1 })).toMatchObject({ tier: "core" });
    expect(computeTier({ ...base, ge60_90d: 3 })).toMatchObject({ tier: "core" });
    expect(computeTier({ ...base, ge60_90d: 2 })).toBeNull();
    expect(computeTier({ ...base, tier: "core" })).toMatchObject({ tier: "longtail" });
    expect(computeTier({ ...base, tier: "core", origin: "seed" })).toBeNull();
    expect(computeTier({ ...base, origin: "seed" })).toMatchObject({ tier: "core" });
    expect(computeTier({ ...base, polledDays: 31 })).toMatchObject({ tier: "dormant" });
    expect(computeTier({ ...base, polledDays: 29 })).toBeNull();
    expect(computeTier({ ...base, tier: "dormant", ge60_90d: 1 })).toMatchObject({ tier: "longtail" });
    expect(computeTier({ ...base, tier: "dormant" })).toBeNull();
    expect(computeTier({ ...base, tier_locked: 1, ge75_90d: 5 })).toBeNull();
    expect(computeTier({ ...base, tier: "muted", ge75_90d: 5 })).toBeNull();
  });
});
describe("retierAll / promoteRecentHighScores", () => {
  it("applies rules over boards × stats and logs events", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:hot", origin: "url" }, { key: "greenhouse:cold", origin: "url" }, { key: "chrome:tesla", origin: "builtin", tier: "longtail" }]);
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES ('a','Hot','SWE','greenhouse','greenhouse:hot')").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 90)").run();
    const r = retierAll(db, new Date());
    expect(r.changed).toBe(1);
    expect(getBoard(db, "greenhouse:hot")!.tier).toBe("core");
    expect(getBoard(db, "greenhouse:cold")!.tier).toBe("longtail");
    expect(getBoard(db, "chrome:tesla")!.tier).toBe("longtail"); // chrome 家族不参与
    expect((db.prepare("SELECT COUNT(*) n FROM events WHERE kind='board_retier'").get() as { n: number }).n).toBe(1);
  });
  it("promotes boards whose jobs just scored >= 75", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "ashby:x", origin: "directory" }]);
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES ('a','X','SWE','ashby','ashby:x')").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 80)").run();
    expect(promoteRecentHighScores(db, iso(new Date(Date.now() - 60_000)))).toBe(1);
    const b = getBoard(db, "ashby:x")!;
    expect(b.tier).toBe("core"); expect(b.next_due_at).toBeNull();
  });
});
```

- [ ] **Step 2: 运行,确认失败**
- [ ] **Step 3: 实现**

```ts
// 追加到 src/scanner/entry-level.ts
// 工程标题门(仅非精选来源):目录里的公司什么岗都发,这道门挡掉零售/财务/护理等明显非工程岗,
// 免得几万个候选岗白白消耗 Claude 打分。宁可放过:词表故意宽。
const ENGINEERING =
  /\b(software|engineer(ing)?|developer|swe|sde|machine learning|\bml\b|\bai\b|data|research|quant(itative)?|firmware|embedded|robotic(s)?|autonomy|perception|security|sre|site reliability|infrastructure|systems?|platform|backend|back-end|full.?stack|frontend|front-end|gpu|cuda|compiler|kernel|devops|cloud|scientist|analyst|technolog(y|ist|ies)|technical|hardware|fpga|asic|controls?|simulation|computer vision|nlp|programmer|architect)\b/i;
export function isEngineeringTitle(title: string): boolean { return ENGINEERING.test(title); }
```

```ts
// src/scanner/retier.ts
import { DB, logEvent } from "@/lib/db";
import { BoardRow, Origin, Tier, boardStats } from "@/scanner/boards";

export interface RetierInput { origin: Origin; tier: Tier; tier_locked: number; ge75_90d: number; ge60_90d: number; polledDays: number; }

// spec §1.4 的分级规则。返回 null = 不变。
export function computeTier(i: RetierInput): { tier: Tier; reason: string } | null {
  if (i.tier_locked) return null;
  if (i.tier === "muted") return null;
  if (i.origin === "seed" || i.origin === "builtin") return i.tier === "core" ? null : { tier: "core", reason: "seed" };
  if (i.ge75_90d >= 1 || i.ge60_90d >= 3) return i.tier === "core" ? null : { tier: "core", reason: `>=75 x${i.ge75_90d}, >=60 x${i.ge60_90d} in 90d` };
  if (i.tier === "core") return { tier: "longtail", reason: "no >=75 in 90d" };
  if (i.tier === "dormant") return i.ge60_90d >= 1 ? { tier: "longtail", reason: ">=60 seen" } : null;
  if (i.tier === "longtail" && i.ge60_90d === 0 && i.polledDays >= 30) return { tier: "dormant", reason: "30d polled, no >=60" };
  return null;
}

export function retierAll(db: DB, now: Date = new Date()): { changed: number } {
  const stats = boardStats(db);
  const boards = db.prepare("SELECT * FROM boards WHERE family <> 'chrome'").all() as BoardRow[];
  const upd = db.prepare("UPDATE boards SET tier=?, tier_reason=?, next_due_at=CASE WHEN ?='core' THEN NULL ELSE next_due_at END, updated_at=datetime('now') WHERE id=?");
  let changed = 0;
  db.transaction(() => {
    for (const b of boards) {
      const s = stats.get(b.key) ?? { ge75_90d: 0, ge60_90d: 0, jobs30: 0, ge75_30: 0 };
      const polledDays = b.last_ok_at ? (now.getTime() - new Date(b.created_at.replace(" ", "T") + "Z").getTime()) / 86_400_000 : 0;
      const r = computeTier({ origin: b.origin, tier: b.tier, tier_locked: b.tier_locked, ge75_90d: s.ge75_90d, ge60_90d: s.ge60_90d, polledDays });
      if (!r) continue;
      upd.run(r.tier, r.reason, r.tier, b.id);
      logEvent(db, "board_retier", { entity: "board", entityId: b.id, payload: { key: b.key, from: b.tier, to: r.tier, reason: r.reason } });
      changed++;
    }
  })();
  return { changed };
}

// 匹配器刚写入的 ≥75 分岗:所属板块立即升 core 并置为到期(spec §1.4 "不等第二天")。
export function promoteRecentHighScores(db: DB, sinceIso: string): number {
  const rows = db.prepare(
    `SELECT DISTINCT b.id, b.key, b.tier FROM matches m JOIN jobs j ON j.id = m.job_id JOIN boards b ON b.key = j.board_key
     WHERE m.score >= 75 AND m.created_at >= ? AND b.tier IN ('longtail','dormant') AND b.tier_locked = 0`
  ).all(sinceIso) as { id: number; key: string; tier: Tier }[];
  const upd = db.prepare("UPDATE boards SET tier='core', tier_reason='high-score job', next_due_at=NULL, updated_at=datetime('now') WHERE id=?");
  for (const r of rows) {
    upd.run(r.id);
    logEvent(db, "board_retier", { entity: "board", entityId: r.id, payload: { key: r.key, from: r.tier, to: "core", reason: "high-score job" } });
  }
  return rows.length;
}
```
db.ts 迁移末尾:`retierAll(db);`(import 自 `@/scanner/retier`)。

- [ ] **Step 4: 运行通过**;`npx vitest run` 全绿。
- [ ] **Step 5: Commit**  `git commit -am "feat(scan): engineering title gate and yield-based board retiering"`

---

### Task 5: 适配器注册表 + Workday 适配器

**Files:**
- Create: `src/scanner/sources/index.ts`、`src/scanner/sources/workday.ts`
- Test: `tests/workday.test.ts`(fixture `tests/fixtures/sources/workday-list.json`、`workday-detail.json`)

**Interfaces:**
- Produces: `interface FetchCtx { fetcher; depth: "core"|"longtail"; isKnownUrl(url): boolean; now: Date; setMeta?(patch): void }`, `type BoardFetcher = (board: BoardRow, ctx: FetchCtx) => Promise<RawJob[]>`, `interface FamilyConfig { fetch; concurrency; minGapMs; gated }`, `type Registry = Partial<Record<Family, FamilyConfig>>`, `LIVE_REGISTRY`(本任务先注册 greenhouse/lever/ashby/workday,后续任务逐个加)。
- 测试用的假 fetcher 约定:`(url, init) => Response`,按 URL 子串分发 fixture。

- [ ] **Step 1: 失败测试**

```ts
// tests/workday.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchWorkday } from "@/scanner/sources/workday";
import type { BoardRow } from "@/scanner/boards";

const list = fs.readFileSync("tests/fixtures/sources/workday-list.json", "utf8");
const detail = fs.readFileSync("tests/fixtures/sources/workday-detail.json", "utf8");
const board = { key: "workday:nvidia.wd5/NVIDIAExternalCareerSite", family: "workday", ident: "nvidia.wd5/NVIDIAExternalCareerSite", company: "NVIDIA", origin: "seed", tier: "core" } as BoardRow;

function fakeFetch(calls: string[]) {
  return async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
    if (url.endsWith("/jobs")) {
      const body = JSON.parse(String(init?.body));
      // 只有第一页有数据;第二页空 → 翻页停止
      return new Response(body.offset === 0 ? list : JSON.stringify({ total: 3, jobPostings: [] }), { status: 200 });
    }
    return new Response(detail, { status: 200 });
  };
}

describe("workday source", () => {
  it("sweeps keywords, dedupes by externalPath, fetches detail for unknown jobs only, maps fields", async () => {
    const calls: string[] = [];
    const jobs = await fetchWorkday(board, { fetcher: fakeFetch(calls), depth: "longtail", isKnownUrl: (u) => u.endsWith("JR2016865"), now: new Date() });
    // fixture 有 3 个岗(都是 New College Grad);其中 JR2016865 已知 → 不拉详情、不返回
    expect(jobs.map((j) => j.applyUrl.endsWith("JR2016865"))).not.toContain(true);
    expect(calls.filter((c) => c.startsWith("POST")).length).toBe(8 * 2); // 8 个词 × (第一页 + 空页)
    const detailCalls = calls.filter((c) => c.startsWith("GET"));
    expect(detailCalls.length).toBe(jobs.length);
    const j = jobs[0];
    expect(j.source).toBe("workday"); expect(j.ats).toBe("workday"); expect(j.company).toBe("NVIDIA");
    expect(j.applyUrl).toMatch(/^https:\/\/nvidia\.wd5\.myworkdayjobs\.com\/NVIDIAExternalCareerSite\/job\//);
    expect(j.jdText).toContain("NVIDIA"); expect(j.jdText).not.toContain("<p>");
    expect(j.postedAt).toBe("2026-06-25"); expect(j.location).toBe("US, CA, Santa Clara");
  });
  it("throws on non-200 list responses", async () => {
    const bad = async () => new Response("{}", { status: 404 });
    await expect(fetchWorkday(board, { fetcher: bad, depth: "core", isKnownUrl: () => false, now: new Date() })).rejects.toThrow(/HTTP 404/);
  });
});
```

- [ ] **Step 2: 运行,确认失败**
- [ ] **Step 3: 实现**

```ts
// src/scanner/sources/index.ts
import { Fetcher, RawJob } from "@/scanner/types";
import { Family } from "@/scanner/board-key";
import { BoardRow } from "@/scanner/boards";
import { fetchGreenhouse } from "@/scanner/sources/greenhouse";
import { fetchLever } from "@/scanner/sources/lever";
import { fetchAshby } from "@/scanner/sources/ashby";
import { fetchWorkday } from "@/scanner/sources/workday";

export interface FetchCtx {
  fetcher: Fetcher;
  depth: "core" | "longtail";          // 翻页深度
  isKnownUrl: (url: string) => boolean; // 已入库的岗不再拉详情
  now: Date;
  setMeta?: (patch: Record<string, unknown>) => void; // 适配器回写 boards.meta(如 ETag)
}
export type BoardFetcher = (board: BoardRow, ctx: FetchCtx) => Promise<RawJob[]>;
export interface FamilyConfig { fetch: BoardFetcher; concurrency: number; minGapMs: number; gated: boolean; }
export type Registry = Partial<Record<Family, FamilyConfig>>;

const name = (b: BoardRow) => b.company ?? b.ident;
export const LIVE_REGISTRY: Registry = {
  greenhouse: { fetch: (b, c) => fetchGreenhouse(b.ident, name(b), c.fetcher), concurrency: 8, minGapMs: 0, gated: true },
  lever: { fetch: (b, c) => fetchLever(b.ident, name(b), c.fetcher), concurrency: 8, minGapMs: 0, gated: true },
  ashby: { fetch: (b, c) => fetchAshby(b.ident, name(b), c.fetcher), concurrency: 8, minGapMs: 0, gated: true },
  workday: { fetch: fetchWorkday, concurrency: 4, minGapMs: 200, gated: true },
};
```

```ts
// src/scanner/sources/workday.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/index";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";
import { locFlag } from "@/scanner/location-filter";

const KEYWORDS = ["new grad", "new college grad", "graduate", "intern", "early career", "university", "entry level", "campus"];
const PAGE = 20;
interface Posting { title: string; externalPath: string; locationsText?: string; postedOn?: string; }

// Workday 站点自己用的 JSON 接口(CXS)。列表不含正文,新岗再拉一次详情。
export async function fetchWorkday(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const [tenantWd, site] = board.ident.split("/");
  const [tenant, wd] = tenantWd.split(".");
  if (!tenant || !wd || !site) throw new Error(`workday ${board.ident}: bad ident`);
  const base = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const cxs = `${base}/wday/cxs/${tenant}/${site}`;
  const maxPages = ctx.depth === "core" ? 25 : 5;
  const seen = new Map<string, Posting>();
  for (const kw of KEYWORDS) {
    for (let page = 0; page < maxPages; page++) {
      const res = await ctx.fetcher(`${cxs}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText: kw }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`workday ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { jobPostings?: Posting[] };
      const posts = data.jobPostings ?? [];
      for (const p of posts) if (p.externalPath && !seen.has(p.externalPath)) seen.set(p.externalPath, p);
      if (posts.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const [path, p] of seen) {
    if (!isEntryLevelTitle(p.title)) continue;
    if (locFlag(p.locationsText ?? null)) continue;            // 明确非美国:不拉详情、不入库
    const applyUrl = `${base}/${site}${path}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "", postedAt: string | null = null, location: string | null = p.locationsText ?? null;
    try {
      const d = await ctx.fetcher(`${cxs}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const info = ((await d.json()) as { jobPostingInfo?: { jobDescription?: string; startDate?: string; location?: string; additionalLocations?: string[] } }).jobPostingInfo ?? {};
        jdText = htmlToText(info.jobDescription ?? "");
        postedAt = info.startDate ?? null;
        if (info.location) location = [info.location, ...(info.additionalLocations ?? [])].join("; ");
      }
    } catch { /* 详情失败:以空正文入库,jd_review 兜底 */ }
    out.push({ company: board.company ?? tenant, title: p.title, location, jdText, applyUrl, source: "workday", ats: "workday", postedAt });
  }
  return out;
}
```
(`index.ts` 与 `workday.ts` 互相 import 类型:把 `FetchCtx` 等类型放到 `src/scanner/sources/types.ts`,`index.ts` re-export,避免循环。下面各适配器都从 `@/scanner/sources/types` 取类型。)

- [ ] **Step 4: 运行通过**
- [ ] **Step 5: Commit**  `git commit -am "feat(scan): adapter registry and Workday CXS adapter"`

---

### Task 6: 字节/TikTok + Amazon 适配器

**Files:**
- Create: `src/scanner/sources/bytedance.ts`、`src/scanner/sources/amazon.ts`
- Modify: `src/scanner/sources/index.ts`(注册)
- Test: `tests/bytedance.test.ts`、`tests/amazon.test.ts`(fixture `bytedance-list.json`、`amazon-search.json`)

- [ ] **Step 1: 失败测试**

```ts
// tests/bytedance.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchBytedance, US_CITIES } from "@/scanner/sources/bytedance";
import type { BoardRow } from "@/scanner/boards";
const list = fs.readFileSync("tests/fixtures/sources/bytedance-list.json", "utf8");
const board = { key: "bytedance:tiktok", family: "bytedance", ident: "tiktok", company: "TikTok", origin: "builtin", tier: "core" } as BoardRow;
describe("bytedance source", () => {
  it("queries both keywords with the storefront header, keeps US cities, builds JD from description+requirement", async () => {
    const calls: { headers: Record<string, string>; body: { portal_type: number; keyword: string; offset: number } }[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ headers: init?.headers as Record<string, string>, body });
      return new Response(body.offset === 0 ? list : JSON.stringify({ code: 0, data: { count: 3, job_post_list: [] } }), { status: 200 });
    };
    const jobs = await fetchBytedance(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() });
    expect(calls[0].headers["website-path"]).toBe("tiktok"); expect(calls[0].body.portal_type).toBe(4);
    expect(new Set(calls.map((c) => c.body.keyword)).size).toBe(4);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) { expect(j.source).toBe("bytedance"); expect(j.company).toBe("TikTok"); expect(US_CITIES.has(j.location!)).toBe(true); expect(j.applyUrl).toMatch(/^https:\/\/lifeattiktok\.com\/search\/\d+$/); }
    expect(jobs[0].jdText).toMatch(/Requirements:/); expect(jobs[0].postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("throws when the API returns a non-zero code", async () => {
    const fetcher = async () => new Response(JSON.stringify({ code: -9000003, message: "bad" }), { status: 200 });
    await expect(fetchBytedance(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() })).rejects.toThrow(/code -9000003/);
  });
});
```

```ts
// tests/amazon.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchAmazon } from "@/scanner/sources/amazon";
import type { BoardRow } from "@/scanner/boards";
const page = fs.readFileSync("tests/fixtures/sources/amazon-search.json", "utf8");
const board = { key: "amazon:us", family: "amazon", ident: "us", company: "Amazon", origin: "builtin", tier: "core" } as BoardRow;
describe("amazon source", () => {
  it("runs the graduate queries, maps job_path/posted_date/description", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("offset=0") ? page : JSON.stringify({ hits: 3, jobs: [] }), { status: 200 }); };
    const jobs = await fetchAmazon(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() });
    expect(urls.some((u) => u.includes("base_query=graduate"))).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    const j = jobs[0];
    expect(j.applyUrl).toMatch(/^https:\/\/www\.amazon\.jobs\/en\/jobs\/\d+/);
    expect(j.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(j.jdText.length).toBeGreaterThan(100); expect(j.source).toBe("amazon");
  });
});
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// src/scanner/sources/bytedance.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

const PORTALS: Record<string, { path: string; portal: number; company: string; url: (id: string) => string }> = {
  tiktok: { path: "tiktok", portal: 4, company: "TikTok", url: (id) => `https://lifeattiktok.com/search/${id}` },
  bytedance: { path: "bytedance", portal: 6, company: "ByteDance", url: (id) => `https://jobs.bytedance.com/en/position/${id}/detail` },
};
const KEYWORDS = ["graduate", "intern", "new grad", "campus"];
const PAGE = 50, MAX_OFFSET = 400;
export const US_CITIES = new Set(["San Jose", "Seattle", "Los Angeles", "New York", "San Francisco", "Mountain View", "Austin", "Chicago", "Bellevue", "Washington", "Irvine", "Culver City", "Miami", "Boston", "Nashville", "Sunnyvale", "Redmond", "Dallas", "Denver", "Atlanta", "Portland"]);
interface Post { id: string; title: string; description?: string; requirement?: string; city_info?: { en_name?: string }; recruit_type?: { en_name?: string; parent?: { en_name?: string } }; publish_time?: number; }

export async function fetchBytedance(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const portal = PORTALS[board.ident];
  if (!portal) throw new Error(`bytedance ${board.ident}: unknown portal`);
  const seen = new Map<string, Post>();
  for (const keyword of KEYWORDS) {
    for (let offset = 0; offset < MAX_OFFSET; offset += PAGE) {
      const res = await ctx.fetcher("https://jobs.bytedance.com/api/v1/search/job/posts", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "website-path": portal.path },
        body: JSON.stringify({ keyword, limit: PAGE, offset, job_category_id_list: [], tag_id_list: [], location_code_list: [], subject_id_list: [], recruitment_id_list: [], portal_type: portal.portal, job_function_id_list: [], storefront_id_list: [], portal_entrance: 1 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`bytedance ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { code: number; data?: { job_post_list?: Post[] } };
      if (data.code !== 0) throw new Error(`bytedance ${board.ident}: code ${data.code}`);
      const posts = data.data?.job_post_list ?? [];
      for (const p of posts) if (!seen.has(p.id)) seen.set(p.id, p);
      if (posts.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const p of seen.values()) {
    const city = p.city_info?.en_name ?? "";
    if (!US_CITIES.has(city) || !isEntryLevelTitle(p.title)) continue;
    const applyUrl = portal.url(p.id);
    if (ctx.isKnownUrl(applyUrl)) continue;
    const jdText = [htmlToText(p.description ?? ""), p.requirement ? "Requirements:\n" + htmlToText(p.requirement) : ""].filter(Boolean).join("\n\n");
    out.push({ company: board.company ?? portal.company, title: p.title, location: city, jdText, applyUrl, source: "bytedance", ats: "bytedance", postedAt: p.publish_time ? new Date(p.publish_time).toISOString() : null, jobKind: /intern/i.test(p.title) ? "intern" : "newgrad" });
  }
  return out;
}
```

```ts
// src/scanner/sources/amazon.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

const QUERIES = ["graduate", "early career", "new grad", "university"];
const PAGE = 100;
interface AmzJob { id: string; title: string; job_path: string; posted_date?: string; description?: string; basic_qualifications?: string; preferred_qualifications?: string; normalized_location?: string; location?: string; country_code?: string; is_intern?: boolean; }

export function parseAmazonDate(s: string | undefined): string | null {
  if (!s) return null;
  const d = new Date(s.replace(/\s+/g, " ").trim() + " UTC");
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function fetchAmazon(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const cap = ctx.depth === "core" ? 300 : 100;
  const seen = new Map<string, AmzJob>();
  for (const q of QUERIES) {
    for (let offset = 0; offset < cap; offset += PAGE) {
      const url = `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}&country%5B%5D=USA&normalized_country_code%5B%5D=USA&result_limit=${PAGE}&offset=${offset}&sort=recent`;
      const res = await ctx.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`amazon ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { jobs?: AmzJob[] };
      const jobs = data.jobs ?? [];
      for (const j of jobs) if (!seen.has(j.id)) seen.set(j.id, j);
      if (jobs.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const j of seen.values()) {
    if (j.country_code && j.country_code !== "USA") continue;
    if (!isEntryLevelTitle(j.title)) continue;
    const applyUrl = `https://www.amazon.jobs${j.job_path}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    const jdText = [j.description, j.basic_qualifications ? "Basic qualifications:\n" + j.basic_qualifications : "", j.preferred_qualifications ? "Preferred qualifications:\n" + j.preferred_qualifications : ""].filter(Boolean).map((s) => htmlToText(s!)).join("\n\n");
    out.push({ company: "Amazon", title: j.title.trim(), location: j.normalized_location ?? j.location ?? null, jdText, applyUrl, source: "amazon", ats: "amazon", postedAt: parseAmazonDate(j.posted_date), jobKind: j.is_intern ? "intern" : undefined });
  }
  return out;
}
```
注册:`bytedance: { fetch: fetchBytedance, concurrency: 1, minGapMs: 500, gated: false }`,`amazon: { fetch: fetchAmazon, concurrency: 1, minGapMs: 500, gated: true }`。

- [ ] **Step 4: 运行通过**  **Step 5: Commit**  `git commit -am "feat(scan): ByteDance/TikTok and Amazon adapters"`

---

### Task 7: SmartRecruiters + Oracle HCM + Workable 适配器

**Files:**
- Create: `src/scanner/sources/smartrecruiters.ts`、`oracle.ts`、`workable.ts`
- Modify: `src/scanner/sources/index.ts`
- Test: `tests/smartrecruiters.test.ts`、`tests/oracle.test.ts`、`tests/workable.test.ts`(fixture `smartrecruiters-list/detail.json`、`oracle-list/detail.json`、`workable-list/detail.json`)

- [ ] **Step 1: 失败测试**(三个文件结构相同,这里给 smartrecruiters,其余两个照此把断言换成各自字段)

```ts
// tests/smartrecruiters.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchSmartRecruiters } from "@/scanner/sources/smartrecruiters";
import type { BoardRow } from "@/scanner/boards";
const list = fs.readFileSync("tests/fixtures/sources/smartrecruiters-list.json", "utf8");
const detail = fs.readFileSync("tests/fixtures/sources/smartrecruiters-detail.json", "utf8");
const board = { key: "smartrecruiters:ServiceNow", family: "smartrecruiters", ident: "ServiceNow", company: "ServiceNow", origin: "url", tier: "longtail" } as BoardRow;
const fetcher = async (url: string) => new Response(/\/postings\/\d+$/.test(url) ? detail : url.includes("offset=0") ? list : JSON.stringify({ totalFound: 3, content: [] }), { status: 200 });
describe("smartrecruiters source", () => {
  it("pages the US postings and fetches detail JD for unknown ones", async () => {
    const jobs = await fetchSmartRecruiters(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() });
    expect(jobs.length).toBeGreaterThan(0);
    const j = jobs[0];
    expect(j.applyUrl).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/ServiceNow\/\d+$/);
    expect(j.location).toContain("San Diego"); expect(j.postedAt).toMatch(/^2026-/); expect(j.jdText).toContain("Team");
    expect(j.jdText).not.toContain("<p>"); expect(j.source).toBe("smartrecruiters");
  });
  it("skips known urls without hitting detail", async () => {
    const urls: string[] = [];
    const f = async (url: string) => { urls.push(url); return fetcher(url); };
    await fetchSmartRecruiters(board, { fetcher: f, depth: "core", isKnownUrl: () => true, now: new Date() });
    expect(urls.some((u) => /\/postings\/\d+$/.test(u))).toBe(false);
  });
});
```
oracle 断言:`applyUrl` 形如 `https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/<Id>`,`postedAt` = 列表 `PostedDate`,`jdText` 含 "American Express",列表请求 URL 含 `siteNumber=CX_1` 且 4 个关键词各一次(第二页为空 → 停)。workable 断言:`applyUrl` = `https://apply.workable.com/thorlabs/j/<shortcode>/`,`location` 含 "Newton",非 US(`countryCode !== "US"` 且非 remote)的被过滤,详情请求走 `/api/v2/accounts/thorlabs/jobs/<shortcode>`。

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// src/scanner/sources/smartrecruiters.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface Posting { id: string; name: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string; fullLocation?: string; remote?: boolean }; }
interface Detail { jobAd?: { sections?: Record<string, { title?: string; text?: string }> }; postingUrl?: string; }

export async function fetchSmartRecruiters(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const id = board.ident;
  const cap = ctx.depth === "core" ? 500 : 200;
  const items: Posting[] = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const res = await ctx.fetcher(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings?limit=100&offset=${offset}&country=us`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`smartrecruiters ${id}: HTTP ${res.status}`);
    const data = (await res.json()) as { totalFound?: number; content?: Posting[] };
    const page = data.content ?? [];
    items.push(...page);
    if (page.length === 0 || offset + 100 >= (data.totalFound ?? 0)) break;
  }
  const out: RawJob[] = [];
  for (const p of items) {
    if (!isEntryLevelTitle(p.name)) continue;
    const applyUrl = `https://jobs.smartrecruiters.com/${id}/${p.id}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "";
    try {
      const d = await ctx.fetcher(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings/${p.id}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const sections = ((await d.json()) as Detail).jobAd?.sections ?? {};
        jdText = ["jobDescription", "qualifications", "additionalInformation"].map((k) => sections[k]?.text ?? "").filter(Boolean).map(htmlToText).join("\n\n");
      }
    } catch { /* 空正文入库 */ }
    const loc = p.location;
    const location = loc?.fullLocation ?? [loc?.city, loc?.region, loc?.country?.toUpperCase()].filter(Boolean).join(", ") ?? null;
    out.push({ company: board.company ?? id, title: p.name, location: location || null, jdText, applyUrl, source: "smartrecruiters", ats: "smartrecruiters", postedAt: p.releasedDate ?? null });
  }
  return out;
}
```

```ts
// src/scanner/sources/oracle.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

const KEYWORDS = ["engineer", "software", "graduate", "intern"];
const PAGE = 25;
interface Req { Id: string; Title: string; PrimaryLocation?: string; PostedDate?: string; secondaryLocations?: { Name?: string }[]; }

export async function fetchOracle(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const slash = board.ident.indexOf("/");
  const host = board.ident.slice(0, slash), site = board.ident.slice(slash + 1);
  if (!host || !site) throw new Error(`oracle ${board.ident}: bad ident`);
  const cap = ctx.depth === "core" ? 100 : 50;
  const seen = new Map<string, Req>();
  for (const kw of KEYWORDS) {
    for (let offset = 0; offset < cap; offset += PAGE) {
      const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=${PAGE},offset=${offset},keyword=${encodeURIComponent(kw)},sortBy=POSTING_DATES_DESC`;
      const res = await ctx.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`oracle ${board.ident}: HTTP ${res.status}`);
      const data = (await res.json()) as { items?: { requisitionList?: Req[] }[] };
      const list = data.items?.[0]?.requisitionList ?? [];
      for (const r of list) if (!seen.has(r.Id)) seen.set(r.Id, r);
      if (list.length < PAGE) break;
    }
  }
  const out: RawJob[] = [];
  for (const r of seen.values()) {
    if (!isEntryLevelTitle(r.Title)) continue;
    const applyUrl = `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "";
    try {
      const d = await ctx.fetcher(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${r.Id}%22,siteNumber=${site}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const it = ((await d.json()) as { items?: { ExternalDescriptionStr?: string; ExternalQualificationsStr?: string; ExternalResponsibilitiesStr?: string }[] }).items?.[0] ?? {};
        jdText = [it.ExternalDescriptionStr, it.ExternalResponsibilitiesStr, it.ExternalQualificationsStr].filter(Boolean).map((s) => htmlToText(s!)).join("\n\n");
      }
    } catch { /* 空正文入库 */ }
    const location = [r.PrimaryLocation, ...(r.secondaryLocations ?? []).map((s) => s.Name)].filter(Boolean).join("; ") || null;
    out.push({ company: board.company ?? host, title: r.Title, location, jdText, applyUrl, source: "oracle", ats: "oracle", postedAt: r.PostedDate ?? null });
  }
  return out;
}
```

```ts
// src/scanner/sources/workable.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

interface WkJob { title: string; shortcode: string; published?: string; remote?: boolean; location?: { city?: string; region?: string; country?: string; countryCode?: string }; }

export async function fetchWorkable(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const acct = board.ident;
  const cap = ctx.depth === "core" ? 300 : 100;
  const items: WkJob[] = [];
  let token: string | undefined;
  while (items.length < cap) {
    const res = await ctx.fetcher(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(acct)}/jobs`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`workable ${acct}: HTTP ${res.status}`);
    const data = (await res.json()) as { results?: WkJob[]; nextPage?: string };
    items.push(...(data.results ?? []));
    if (!data.nextPage || (data.results ?? []).length === 0) break;
    token = data.nextPage;
  }
  const out: RawJob[] = [];
  for (const j of items) {
    const us = j.location?.countryCode === "US" || j.location?.country === "United States" || (!j.location?.country && j.remote);
    if (!us || !isEntryLevelTitle(j.title)) continue;
    const applyUrl = `https://apply.workable.com/${acct}/j/${j.shortcode}/`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "";
    try {
      const d = await ctx.fetcher(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(acct)}/jobs/${j.shortcode}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) { const det = (await d.json()) as { description?: string; requirements?: string }; jdText = [det.description, det.requirements ? "Requirements:\n" + det.requirements : ""].filter(Boolean).map((s) => htmlToText(s!)).join("\n\n"); }
    } catch { /* 空正文入库 */ }
    const location = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ") || (j.remote ? "Remote, US" : null);
    out.push({ company: board.company ?? acct, title: j.title, location, jdText, applyUrl, source: "workable", ats: "workable", postedAt: j.published ?? null });
  }
  return out;
}
```
注册三者:concurrency 4、minGapMs 200、gated true。

- [ ] **Step 4: 运行通过**  **Step 5: Commit**  `git commit -am "feat(scan): SmartRecruiters, Oracle HCM and Workable adapters"`

---

### Task 8: iCIMS(HTML)+ LinkedIn 游客适配器

**Files:**
- Create: `src/scanner/sources/icims.ts`、`src/scanner/sources/linkedin-guest.ts`
- Modify: `src/scanner/sources/index.ts`
- Test: `tests/icims.test.ts`、`tests/linkedin-guest.test.ts`(fixture `icims-search.html`、`icims-job.html`、`linkedin-search.html`、`linkedin-detail.html`)

- [ ] **Step 1: 失败测试**

```ts
// tests/icims.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchIcims, parseIcimsSearch, parseIcimsJob } from "@/scanner/sources/icims";
import type { BoardRow } from "@/scanner/boards";
const search = fs.readFileSync("tests/fixtures/sources/icims-search.html", "utf8");
const job = fs.readFileSync("tests/fixtures/sources/icims-job.html", "utf8");
const board = { key: "icims:careers-sig.icims.com", family: "icims", ident: "careers-sig.icims.com", company: "SIG", origin: "url", tier: "longtail" } as BoardRow;
describe("icims source", () => {
  it("parses 20 job cards (id, url, title) from the search page", () => {
    const cards = parseIcimsSearch(search, "careers-sig.icims.com");
    expect(cards.length).toBe(20);
    expect(cards[0]).toMatchObject({ id: "11099", title: "Analytics Internship: Fall 2026" });
    expect(cards[0].url).toBe("https://careers-sig.icims.com/jobs/11099/analytics-internship%3a-fall-2026/job");
  });
  it("extracts JD text and header fields from a job page", () => {
    const d = parseIcimsJob(job);
    expect(d.jdText).toContain("River's Edge"); expect(d.jdText).not.toContain("<p"); expect(d.fields["Experience Level"]).toBe("Interns + Co-ops");
  });
  it("fetches search pages per keyword then job pages for unknown urls", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("/jobs/search") ? (url.includes("pr=0") ? search : "<html></html>") : job, { status: 200 }); };
    const jobs = await fetchIcims(board, { fetcher, depth: "longtail", isKnownUrl: () => false, now: new Date() });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].applyUrl).toMatch(/^https:\/\/careers-sig\.icims\.com\/jobs\/\d+\//); expect(jobs[0].source).toBe("icims");
    expect(urls.filter((u) => u.includes("in_iframe=1") && !u.includes("/jobs/search")).length).toBe(jobs.length);
  });
});
```

```ts
// tests/linkedin-guest.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { parseLinkedinCards, parseLinkedinDetail, fetchLinkedinGuest, LINKEDIN_QUERIES } from "@/scanner/sources/linkedin-guest";
import type { BoardRow } from "@/scanner/boards";
const search = fs.readFileSync("tests/fixtures/sources/linkedin-search.html", "utf8");
const detail = fs.readFileSync("tests/fixtures/sources/linkedin-detail.html", "utf8");
const board = { key: "linkedin:guest", family: "linkedin", ident: "guest", company: null, origin: "builtin", tier: "core" } as BoardRow;
describe("linkedin guest source", () => {
  it("parses cards", () => {
    const cards = parseLinkedinCards(search);
    expect(cards.length).toBe(10);
    expect(cards[0]).toMatchObject({ id: "4463654152", title: "Software Engineer - Recent Graduate", company: "PayPal" });
    expect(cards[0].postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(cards[0].location).toBeTruthy();
  });
  it("parses detail", () => {
    const d = parseLinkedinDetail(detail);
    expect(d.title).toBe("Software Engineer - Recent Graduate"); expect(d.company).toBe("PayPal"); expect(d.location).toBe("Chicago, IL");
    expect(d.jdText).toContain("PayPal"); expect(d.criteria["Employment type"]).toBe("Full-time");
  });
  it("runs queries with a 3s gap policy hook, skips known ids, throws on 429", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("seeMoreJobPostings") ? (url.includes("start=0") ? search : "") : detail, { status: 200 }); };
    const jobs = await fetchLinkedinGuest(board, { fetcher, depth: "longtail", isKnownUrl: (u) => u.includes("4463654152"), now: new Date(), sleep: async () => {} });
    expect(urls.filter((u) => u.includes("f_TPR=r86400")).length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.applyUrl !== "https://www.linkedin.com/jobs/view/4463654152/")).toBe(true);
    expect(jobs[0].source).toBe("linkedin"); expect(jobs[0].ats).toBeNull(); expect(jobs[0].jdText).toContain("PayPal");
    const limited = async () => new Response("", { status: 429 });
    await expect(fetchLinkedinGuest(board, { fetcher: limited, depth: "core", isKnownUrl: () => false, now: new Date(), sleep: async () => {} })).rejects.toThrow(/HTTP 429/);
    expect(Object.keys(LINKEDIN_QUERIES).length).toBe(12);
  });
});
```
(`FetchCtx` 加可选 `sleep?: (ms: number) => Promise<void>`,默认 setTimeout;测试注入空函数。)

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// src/scanner/sources/icims.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

const KEYWORDS = ["engineer", "software", "graduate", "intern"];
export interface IcimsCard { id: string; url: string; title: string; location: string | null; }

export function parseIcimsSearch(html: string, host: string): IcimsCard[] {
  const out: IcimsCard[] = [];
  const seen = new Set<string>();
  const esc = host.replace(/\./g, "\\.");
  const re = new RegExp(`<a\\s+href="(https://${esc}/jobs/(\\d+)/[^"?#]+/job)[^"]*"[^>]*class="iCIMS_Anchor"[^>]*>([\\s\\S]*?)</a>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (seen.has(m[2])) continue;
    const inner = m[3];
    const h = inner.match(/<h[23][^>]*>\s*([\s\S]*?)\s*<\/h[23]>/);
    const title = htmlToText(h ? h[1] : inner).trim();
    if (!title) continue;
    // 同一张卡片后面可能带 Job Locations 字段
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const loc = tail.match(/Job Locations<\/span>\s*<span[^>]*>\s*([^<]+?)\s*</);
    seen.add(m[2]);
    out.push({ id: m[2], url: m[1], title, location: loc ? loc[1].trim() : null });
  }
  return out;
}

export function parseIcimsJob(html: string): { jdText: string; fields: Record<string, string> } {
  const blocks = [...html.matchAll(/<div class="iCIMS_Expandable_Text">([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => htmlToText(m[1]));
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<dt class="iCIMS_JobHeaderField">\s*([^<]+?)\s*<\/dt>\s*<dd class="iCIMS_JobHeaderData">\s*(?:<span[^>]*>)?\s*([^<]+?)\s*</g)) fields[m[1].trim()] = m[2].trim();
  return { jdText: blocks.join("\n\n").trim(), fields };
}

export async function fetchIcims(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const host = board.ident;
  const pages = ctx.depth === "core" ? 5 : 2;
  const cards = new Map<string, IcimsCard>();
  for (const kw of KEYWORDS) {
    for (let p = 0; p < pages; p++) {
      const res = await ctx.fetcher(`https://${host}/jobs/search?ss=1&searchKeyword=${encodeURIComponent(kw)}&in_iframe=1&pr=${p}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`icims ${host}: HTTP ${res.status}`);
      const found = parseIcimsSearch(await res.text(), host);
      for (const c of found) if (!cards.has(c.id)) cards.set(c.id, c);
      if (found.length === 0) break;
    }
  }
  const out: RawJob[] = [];
  for (const c of cards.values()) {
    if (!isEntryLevelTitle(c.title) || ctx.isKnownUrl(c.url)) continue;
    let jdText = "", location = c.location, postedAt: string | null = null;
    try {
      const d = await ctx.fetcher(`${c.url}?in_iframe=1`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
      if (d.ok) {
        const parsed = parseIcimsJob(await d.text());
        jdText = parsed.jdText;
        location = location ?? parsed.fields["Job Locations"] ?? parsed.fields["Location"] ?? null;
        const pd = parsed.fields["Posted Date"]; if (pd && !Number.isNaN(Date.parse(pd))) postedAt = new Date(pd).toISOString().slice(0, 10);
      }
    } catch { /* 空正文入库 */ }
    out.push({ company: board.company ?? host, title: c.title, location, jdText, applyUrl: c.url, source: "icims", ats: "icims", postedAt });
  }
  return out;
}
```

```ts
// src/scanner/sources/linkedin-guest.ts
import { RawJob } from "@/scanner/types";
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { htmlToText } from "@/scanner/html";
import { isEntryLevelTitle } from "@/scanner/entry-level";

// 12 个方向各 2 组词;顺序按 profile tier(1 → 3)。
export const LINKEDIN_QUERIES: Record<string, string[]> = {
  swe_general: ['"new grad" software engineer', 'software engineer "university graduate" 2027'],
  swe_backend: ['"new grad" backend engineer', '"new grad" distributed systems engineer'],
  ai_infra: ['"new grad" machine learning infrastructure engineer', '"new grad" ML systems engineer'],
  mle: ['"new grad" machine learning engineer', '"new grad" applied scientist'],
  quant: ['"new grad" quantitative developer', '"new grad" quantitative researcher'],
  embedded: ['"new grad" embedded software engineer', '"new grad" firmware engineer'],
  systems_perf: ['"new grad" systems engineer performance', '"new grad" compiler engineer'],
  robotics: ['"new grad" robotics software engineer', '"new grad" autonomy engineer'],
  sre_infra: ['"new grad" site reliability engineer', '"new grad" infrastructure engineer'],
  data: ['"new grad" data engineer', '"new grad" data scientist'],
  security: ['"new grad" security engineer', '"new grad" security analyst'],
  gpu_cuda: ['"new grad" CUDA engineer', '"new grad" GPU kernel engineer'],
};
export interface LiCard { id: string; title: string; company: string; location: string | null; postedAt: string | null; }
export interface LiDetail { title: string | null; company: string | null; location: string | null; jdText: string; criteria: Record<string, string>; }

const clean = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim();

export function parseLinkedinCards(html: string): LiCard[] {
  const out: LiCard[] = [];
  const parts = html.split(/<div class="base-card/).slice(1);
  for (const p of parts) {
    const id = p.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/)?.[1];
    const title = p.match(/base-search-card__title">([\s\S]*?)<\/h3>/)?.[1];
    if (!id || !title) continue;
    const company = p.match(/base-search-card__subtitle">([\s\S]*?)<\/h4>/)?.[1] ?? "";
    const location = p.match(/job-search-card__location">([\s\S]*?)<\/span>/)?.[1];
    const postedAt = p.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? null;
    out.push({ id, title: clean(title), company: clean(company), location: location ? clean(location) : null, postedAt });
  }
  return out;
}

export function parseLinkedinDetail(html: string): LiDetail {
  const title = html.match(/<h2 class="top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/)?.[1];
  const company = html.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/)?.[1];
  const location = html.match(/topcard__flavor topcard__flavor--bullet">([\s\S]*?)<\/span>/)?.[1];
  const desc = html.match(/show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const criteria: Record<string, string> = {};
  for (const m of html.matchAll(/description__job-criteria-subheader">\s*([^<]+?)\s*<\/h3>\s*<span[^>]*>\s*([^<]+?)\s*</g)) criteria[m[1].trim()] = m[2].trim();
  return { title: title ? clean(title) : null, company: company ? clean(company) : null, location: location ? clean(location) : null, jdText: htmlToText(desc).trim(), criteria };
}

export async function fetchLinkedinGuest(board: BoardRow, ctx: FetchCtx & { sleep?: (ms: number) => Promise<void> }): Promise<RawJob[]> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const staleDays = board.last_ok_at ? (ctx.now.getTime() - new Date(board.last_ok_at.replace(" ", "T") + "Z").getTime()) / 86_400_000 : 99;
  const tpr = staleDays > 2 ? "r604800" : "r86400";
  const maxDetails = ctx.depth === "core" ? 80 : 40;
  const pages = ctx.depth === "core" ? 3 : 2;
  const cards = new Map<string, LiCard>();
  let strikes = 0;
  const get = async (url: string) => {
    const res = await ctx.fetcher(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 || res.status === 999) { if (++strikes >= 2) throw new Error(`linkedin guest: HTTP ${res.status}`); await sleep(30_000); return null; }
    if (!res.ok) throw new Error(`linkedin guest: HTTP ${res.status}`);
    await sleep(3000);
    return res.text();
  };
  for (const queries of Object.values(LINKEDIN_QUERIES)) {
    for (const kw of queries) {
      for (let p = 0; p < pages; p++) {
        const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&location=United%20States&f_TPR=${tpr}&f_E=1%2C2&sortBy=DD&start=${p * 25}`);
        if (html === null) continue;
        const found = parseLinkedinCards(html);
        for (const c of found) if (!cards.has(c.id)) cards.set(c.id, c);
        if (found.length === 0) break;
      }
    }
  }
  const out: RawJob[] = [];
  for (const c of cards.values()) {
    if (out.length >= maxDetails) break;
    if (!isEntryLevelTitle(c.title)) continue;
    const applyUrl = `https://www.linkedin.com/jobs/view/${c.id}/`;
    if (ctx.isKnownUrl(applyUrl)) continue;
    let jdText = "", location = c.location, title = c.title, company = c.company;
    const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${c.id}`);
    if (html) { const d = parseLinkedinDetail(html); jdText = d.jdText; location = d.location ?? location; title = d.title ?? title; company = d.company ?? company; if (/internship/i.test(d.criteria["Employment type"] ?? "")) title = title; }
    if (!company) continue;
    out.push({ company, title, location, jdText, applyUrl, source: "linkedin", ats: null, postedAt: c.postedAt });
  }
  return out;
}
```
注册:`icims: { fetch: fetchIcims, concurrency: 2, minGapMs: 500, gated: true }`,`linkedin: { fetch: fetchLinkedinGuest, concurrency: 1, minGapMs: 3000, gated: true }`。

- [ ] **Step 4: 运行通过**  **Step 5: Commit**  `git commit -am "feat(scan): iCIMS HTML adapter and LinkedIn guest adapter"`

---

### Task 9: 6 份 GitHub 清单(README 表格解析 + ETag)

**Files:**
- Create: `src/scanner/sources/readme-table.ts`
- Modify: `src/scanner/sources/github-lists.ts`(加 `LIST_BOARDS`、`fetchListBoard`;保留 `fetchGithubList`、`DEFAULT_LISTS`)
- Modify: `src/scanner/sources/index.ts`
- Test: `tests/readme-table.test.ts`、`tests/github-lists.test.ts`(追加 fetchListBoard 用例)

- [ ] **Step 1: 失败测试**

```ts
// tests/readme-table.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { parseReadmeTable, parseAge } from "@/scanner/sources/readme-table";
const md = fs.readFileSync("tests/fixtures/sources/zapply-readme.md", "utf8");
const NOW = new Date("2026-09-06T12:00:00Z");
describe("readme table parser", () => {
  it("parses company/title/location/link/age and carries ↳ companies forward", () => {
    const rows = parseReadmeTable(md, { kind: "newgrad", now: NOW });
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]).toMatchObject({ company: "Western Digital", title: "Software Engineer", location: "San Jose, CA", source: "github_list", jobKind: "newgrad" });
    expect(rows[0].applyUrl).toBe("https://jobs.smartrecruiters.com/WesternDigital/744000138717897");
    const arrow = "| ↳ | Backend Engineer | Austin, TX | 2d | ✅ Sponsor | [<img src=\"images/apply.png\">](https://jobs.lever.co/x/1) |";
    const r2 = parseReadmeTable("| Company | Role | Location | Posted | Visa | **Apply** |\n|---|---|---|---|---|---|\n| **Acme** | SWE | NYC | 1h | ✅ | [x](https://a.example/1) |\n" + arrow, { kind: "intern", now: NOW });
    expect(r2[1].company).toBe("Acme"); expect(r2[1].jobKind).toBe("intern");
  });
  it("converts relative ages", () => {
    expect(parseAge("12m", NOW)).toBe("2026-09-06T11:48:00.000Z");
    expect(parseAge("2d", NOW)).toBe("2026-09-04T12:00:00.000Z");
    expect(parseAge("3w", NOW)).toBe("2026-08-16T12:00:00.000Z");
    expect(parseAge("1mo", NOW)).toBe("2026-08-07T12:00:00.000Z");
    expect(parseAge("?", NOW)).toBeNull();
  });
});
```

```ts
// 追加到 tests/github-lists.test.ts
import { fetchListBoard, LIST_BOARDS } from "@/scanner/sources/github-lists";
import type { BoardRow } from "@/scanner/boards";
describe("fetchListBoard", () => {
  it("defines 6 list boards and honors ETag (304 → no rows, 200 → rows + setMeta)", async () => {
    expect(LIST_BOARDS.map((b) => b.key).sort()).toEqual(["github_list:simplify-intern-2027", "github_list:simplify-newgrad", "github_list:vanshb03-intern-2027", "github_list:vanshb03-newgrad-2027", "github_list:zapply-intern-2027", "github_list:zapply-newgrad-2027"]);
    const board = { key: "github_list:simplify-newgrad", family: "github_list", ident: "simplify-newgrad", origin: "builtin", tier: "core", meta: JSON.stringify({ etag: "\"abc\"" }) } as BoardRow;
    const seen: Record<string, unknown>[] = [];
    const notModified = async (_u: string, init?: RequestInit) => { expect((init?.headers as Record<string, string>)["if-none-match"]).toBe("\"abc\""); return new Response(null, { status: 304 }); };
    expect(await fetchListBoard(board, { fetcher: notModified, depth: "core", isKnownUrl: () => false, now: new Date(), setMeta: (p) => seen.push(p) })).toEqual([]);
    const fixture = fs.readFileSync("tests/fixtures/github-listings.json", "utf8");
    const ok = async () => new Response(fixture, { status: 200, headers: { etag: "\"def\"" } });
    const rows = await fetchListBoard(board, { fetcher: ok, depth: "core", isKnownUrl: () => false, now: new Date(), setMeta: (p) => seen.push(p) });
    expect(rows.length).toBeGreaterThan(0); expect(seen).toEqual([{ etag: "\"def\"" }]);
  });
});
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// src/scanner/sources/readme-table.ts
import { RawJob } from "@/scanner/types";

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000, mo: 30 * 86_400_000 };
export function parseAge(s: string, now: Date): string | null {
  const m = s.trim().match(/^(\d+)\s*(mo|m|h|d|w)$/i);
  if (!m) return null;
  return new Date(now.getTime() - Number(m[1]) * UNITS[m[2].toLowerCase()]).toISOString();
}
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\*\*/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/&amp;/g, "&").trim();
const links = (cell: string) => [...cell.matchAll(/\((https?:\/\/[^)\s]+)\)|href="(https?:\/\/[^"]+)"/g)].map((m) => m[1] ?? m[2]);

// zapplyjobs 风格 README:| Company | Role | Location | Posted | Visa | Apply |;`↳` 表示沿用上一行公司。
export function parseReadmeTable(md: string, opts: { kind: "newgrad" | "intern"; now: Date }): RawJob[] {
  const lines = md.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return [];
  const header = lines[0].split("|").slice(1, -1).map((h) => strip(h).toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const ci = col(["company"]), ti = col(["role", "title", "position"]), li = col(["location"]), ai = col(["posted", "age", "date"]), ki = col(["apply", "link"]);
  if (ci < 0 || ti < 0) return [];
  const out: RawJob[] = [];
  let lastCompany = "";
  for (const line of lines.slice(1)) {
    if (/^\|\s*:?-+/.test(line)) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length <= Math.max(ci, ti)) continue;
    let company = strip(cells[ci]);
    if (company === "↳" || company === "") company = lastCompany; else lastCompany = company;
    const title = strip(cells[ti]);
    const url = (ki >= 0 ? links(cells[ki]) : links(line)).find((u) => !/simplify\.jobs\/p\/|images\/apply|jobright\.ai\/jobs\/info/.test(u));
    if (!company || !title || !url) continue;
    out.push({ company, title, location: li >= 0 ? strip(cells[li]).replace(/<\/?br\s*\/?>/gi, "; ") || null : null, jdText: "", applyUrl: url, source: "github_list", ats: null, postedAt: ai >= 0 ? parseAge(strip(cells[ai]), opts.now) : null, jobKind: opts.kind });
  }
  return out;
}
```

```ts
// 追加到 src/scanner/sources/github-lists.ts
import { BoardRow } from "@/scanner/boards";
import { FetchCtx } from "@/scanner/sources/types";
import { parseReadmeTable } from "@/scanner/sources/readme-table";

export interface ListBoard { key: string; company: string; url: string; kind: "newgrad" | "intern"; format: "json" | "readme"; }
export const LIST_BOARDS: ListBoard[] = [
  { key: "github_list:simplify-newgrad", company: "SimplifyJobs/New-Grad-Positions", url: DEFAULT_LISTS[0].url, kind: "newgrad", format: "json" },
  { key: "github_list:simplify-intern-2027", company: "SimplifyJobs/Summer2027-Internships", url: DEFAULT_LISTS[1].url, kind: "intern", format: "json" },
  { key: "github_list:vanshb03-newgrad-2027", company: "vanshb03/New-Grad-2027", url: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json", kind: "newgrad", format: "json" },
  { key: "github_list:vanshb03-intern-2027", company: "vanshb03/Summer2027-Internships", url: "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json", kind: "intern", format: "json" },
  { key: "github_list:zapply-newgrad-2027", company: "zapplyjobs/New-Grad-Jobs-2027", url: "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Jobs-2027/main/README.md", kind: "newgrad", format: "readme" },
  { key: "github_list:zapply-intern-2027", company: "zapplyjobs/Internships-2027", url: "https://raw.githubusercontent.com/zapplyjobs/Internships-2027/main/README.md", kind: "intern", format: "readme" },
];

export async function fetchListBoard(board: BoardRow, ctx: FetchCtx): Promise<RawJob[]> {
  const spec = LIST_BOARDS.find((l) => l.key === board.key);
  if (!spec) throw new Error(`github_list ${board.ident}: unknown list`);
  let etag: string | undefined;
  try { etag = board.meta ? (JSON.parse(board.meta) as { etag?: string }).etag : undefined; } catch { etag = undefined; }
  const res = await ctx.fetcher(spec.url, { headers: etag ? { "if-none-match": etag } : {}, signal: AbortSignal.timeout(30_000) });
  if (res.status === 304) return [];
  if (!res.ok) throw new Error(`github_list ${board.ident}: HTTP ${res.status}`);
  const newTag = res.headers.get("etag");
  if (newTag && newTag !== etag) ctx.setMeta?.({ etag: newTag });
  if (spec.format === "json") {
    const data = (await res.json()) as Listing[];
    return mapListings(data, spec.kind);           // 把现有 fetchGithubList 的 filter/map 抽成 mapListings(data, kind) 共用
  }
  return parseReadmeTable(await res.text(), { kind: spec.kind, now: ctx.now });
}
```
注册:`github_list: { fetch: fetchListBoard, concurrency: 3, minGapMs: 0, gated: false }`。

- [ ] **Step 4: 运行通过**  **Step 5: Commit**  `git commit -am "feat(scan): six GitHub list boards with README-table parser and ETag"`

---

### Task 10: 调度器、接力、目录导入、种子、tick 路由

**Files:**
- Create: `src/scanner/scheduler.ts`、`src/scanner/relay.ts`、`src/scanner/sources/directory.ts`、`config/boards.seed.json`、`src/app/api/scan/tick/route.ts`、`scripts/import-directory.ts`、`scripts/retier.ts`
- Modify: `src/scanner/run.ts`(薄包装)、`src/app/api/scan/route.ts`(去通知、用 relay)、`src/instrumentation.ts`、`package.json`(scripts)、`src/scanner/consolidate.ts`(pickCanonical 对 linkedin 降权)
- Test: `tests/scheduler.test.ts`、`tests/relay.test.ts`、`tests/directory.test.ts`、`tests/scan-run.test.ts`(重写)

**Interfaces:**
- `runTick(db, opts?: TickOptions): Promise<TickSummary>`;`runSweep(db, opts?)`;`runScan(db, opts?) : Promise<ScanSummary>`(旧形状);`startPostScanPipeline(db): boolean`;`matchBudget(db, cap?)`;`unscoredBacklog(db): number`;`directoryToSpecs(entries): BoardSpec[]`;`importDirectory(db, entries, {now, spreadHours?, rand?}): {inserted, skipped}`;`DIRECTORY_URL`;`DEFAULT_SEED: SeedEntry[]`(从 json 读)。

- [ ] **Step 1: 种子文件** `config/boards.seed.json`:把 `config/watchlist.seed.json` 的 28 家可轮询公司换算成 key(`greenhouse:<token>` 等),加:
  - 内置:`github_list:*` 六份(`builtin: true`,company 为 repo 名)、`bytedance:tiktok`、`bytedance:bytedance`、`amazon:us`、`linkedin:guest`、`chrome:linkedin`、`chrome:handshake`、`chrome:tesla`(全部 `builtin: true`)。
  - 原 7 家:`workday:nvidia.wd5/NVIDIAExternalCareerSite`(NVIDIA)、`greenhouse:janestreet`、`greenhouse:waymo`。
  - 方向补缺(spec §2 列表)全部加入,directions 按方向标。
  JSON 条目形如 `{ "key": "greenhouse:stripe", "company": "Stripe", "directions": ["swe_backend","swe_general"] }`。删除 `config/watchlist.seed.json` 的引用(文件可留)。

- [ ] **Step 2: 失败测试**

```ts
// tests/scheduler.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { runTick, runSweep } from "@/scanner/scheduler";
import { upsertBoards, getBoard, iso } from "@/scanner/boards";
import type { Registry } from "@/scanner/sources/types";
import { RawJob } from "@/scanner/types";

const NOW = new Date("2026-09-06T18:00:00Z");
const job = (o: Partial<RawJob>): RawJob => ({ company: "Acme", title: "Software Engineer New Grad", location: "SF", jdText: "jd", applyUrl: "https://boards.greenhouse.io/acme/jobs/1", source: "greenhouse", ats: "greenhouse", postedAt: null, ...o });

describe("runTick", () => {
  it("polls due boards by family, gates titles for non-seed boards, upserts, writes board state and a scan_tick event", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, [
      { key: "greenhouse:acme", company: "Acme", origin: "url" },
      { key: "greenhouse:seedco", company: "SeedCo", origin: "seed" },
      { key: "workday:t.wd1/site", company: "T", origin: "directory" },
      { key: "greenhouse:broken", origin: "url" },
    ]);
    const registry: Registry = {
      greenhouse: { concurrency: 2, minGapMs: 0, gated: true, fetch: async (b) => {
        if (b.ident === "broken") throw new Error("greenhouse broken: HTTP 404");
        return [job({ company: b.company!, applyUrl: `https://boards.greenhouse.io/${b.ident}/jobs/1` }), job({ company: b.company!, title: "Store Manager", applyUrl: `https://boards.greenhouse.io/${b.ident}/jobs/2` })];
      } },
      workday: { concurrency: 1, minGapMs: 0, gated: true, fetch: async () => [job({ company: "T", source: "workday", ats: "workday", applyUrl: "https://t.wd1.myworkdayjobs.com/site/job/x" })] },
    };
    const s = await runTick(db, { now: NOW, registry, seed: null, rand: () => 0.5, localHour: 12 });
    expect(s.boards).toBe(4);
    // url 板块被门挡掉 Store Manager,种子板块不挡
    expect(s.inserted).toBe(1 + 2 + 1);
    expect(s.errors).toEqual([{ key: "greenhouse:broken", error: "greenhouse broken: HTTP 404" }]);
    expect(s.byFamily.greenhouse).toEqual({ boards: 3, inserted: 3, errors: 1 });
    expect(getBoard(db, "greenhouse:acme")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 24 * 3600_000)));
    expect(getBoard(db, "greenhouse:broken")!.fail_count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM events WHERE kind='scan_tick'").get() as { n: number }).n).toBe(1);
    // 第二次 tick:没有到期的板块
    const s2 = await runTick(db, { now: NOW, registry, seed: null, localHour: 12 });
    expect(s2.boards).toBe(0);
  });
  it("respects budgetBoards and the keys filter; runSweep forces due", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:a", origin: "url" }, { key: "greenhouse:b", origin: "url" }]);
    const registry: Registry = { greenhouse: { concurrency: 1, minGapMs: 0, gated: false, fetch: async () => [] } };
    expect((await runTick(db, { now: NOW, registry, seed: null, budgetBoards: 1, localHour: 12 })).boards).toBe(1);
    expect((await runTick(db, { now: NOW, registry, seed: null, keys: ["greenhouse:b"], localHour: 12 })).boards).toBe(1);
    expect((await runTick(db, { now: NOW, registry, seed: null, localHour: 12 })).boards).toBe(0);
    expect((await runSweep(db, { now: NOW, registry, seed: null, tiers: ["longtail"], localHour: 12 })).boards).toBe(2);
  });
  it("syncs the seed on first tick when seed is provided", async () => {
    const db = openDb(":memory:");
    await runTick(db, { now: NOW, registry: {}, seed: [{ key: "ashby:openai", company: "OpenAI" }], localHour: 12 });
    expect(getBoard(db, "ashby:openai")!.tier).toBe("core");
  });
});
```

```ts
// tests/relay.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { matchBudget, unscoredBacklog } from "@/scanner/relay";
describe("relay budget", () => {
  it("caps matching per hour and counts eligible unscored jobs", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES ('a','A','SWE','greenhouse'), ('b','B','SWE','greenhouse')").run();
    db.prepare("INSERT INTO applications (job_id) VALUES (1), (2)").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 50)").run();
    expect(matchBudget(db, 10)).toBe(9);
    expect(unscoredBacklog(db)).toBe(1);
  });
});
```

```ts
// tests/directory.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import { openDb } from "@/lib/db";
import { directoryToSpecs, importDirectory } from "@/scanner/sources/directory";
import { getBoard } from "@/scanner/boards";
const entries = JSON.parse(fs.readFileSync("tests/fixtures/sources/directory-sample.json", "utf8"));
describe("directory import", () => {
  it("maps supported ATS entries to board specs and skips unsupported ones", () => {
    const specs = directoryToSpecs(entries);
    expect(specs.find((s) => s.key === "workday:2020companies.wd1/external_careers")).toMatchObject({ company: "2020 Companies", origin: "directory" });
    expect(specs.find((s) => s.key === "greenhouse:1800contacts")).toBeTruthy();
    expect(specs.some((s) => s.key.startsWith("oracle:") && s.key.includes("/CX_"))).toBe(true);
    expect(specs.some((s) => s.key.startsWith("rippling"))).toBe(false);
  });
  it("inserts as longtail with next_due_at spread over the window and never overrides existing boards", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-09-06T00:00:00Z");
    db.prepare("INSERT INTO boards (key, family, ident, origin, tier) VALUES ('greenhouse:1800contacts','greenhouse','1800contacts','seed','core')").run();
    const r = importDirectory(db, entries, { now, spreadHours: 72, rand: () => 0.5 });
    expect(r.skipped).toBe(1); expect(r.inserted).toBeGreaterThan(5);
    expect(getBoard(db, "greenhouse:1800contacts")!.tier).toBe("core");
    const b = getBoard(db, "workday:2020companies.wd1/external_careers")!;
    expect(b.tier).toBe("longtail"); expect(b.next_due_at).toBe("2026-09-07 12:00:00");
  });
});
```

`tests/scan-run.test.ts` 重写为:`runScan(db, { registry, seed: [...] })` 返回 `{inserted, upgraded, duplicates, visaSkipped, locSkipped, sourceErrors, durationMs}` 且写 `scan_done` 事件;失败板块出现在 `sourceErrors[].source === key`。

- [ ] **Step 3: 确认失败**
- [ ] **Step 4: 实现**

```ts
// src/scanner/sources/types.ts —— 见 Task 5,加:sleep?: (ms) => Promise<void>
```

```ts
// src/scanner/scheduler.ts
import { DB, logEvent } from "@/lib/db";
import { Family } from "@/scanner/board-key";
import { BoardRow, SeedEntry, Tier, dueBoards, markBoardResult, mergeBoardMeta, syncBoardsSeed } from "@/scanner/boards";
import { LIVE_REGISTRY } from "@/scanner/sources/index";
import { FamilyConfig, Registry } from "@/scanner/sources/types";
import { upsertJobs } from "@/scanner/upsert";
import { isEngineeringTitle } from "@/scanner/entry-level";
import { Fetcher } from "@/scanner/types";
import seedJson from "../../config/boards.seed.json";

export const DEFAULT_SEED = seedJson as SeedEntry[];

export interface TickOptions {
  now?: Date; budgetBoards?: number; budgetMs?: number; families?: Family[]; tiers?: Tier[]; keys?: string[];
  registry?: Registry; fetcher?: Fetcher; seed?: SeedEntry[] | null; rand?: () => number; localHour?: number;
}
export interface TickSummary {
  boards: number; inserted: number; upgraded: number; duplicates: number; visaSkipped: number; locSkipped: number;
  byFamily: Record<string, { boards: number; inserted: number; errors: number }>;
  errors: { key: string; error: string }[]; durationMs: number;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let seedSynced = false;

export async function runTick(db: DB, opts: TickOptions = {}): Promise<TickSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const registry = opts.registry ?? LIVE_REGISTRY;
  const fetcher = opts.fetcher ?? fetch;
  if (opts.seed !== null && (opts.seed || !seedSynced)) { syncBoardsSeed(db, opts.seed ?? DEFAULT_SEED); if (!opts.seed) seedSynced = true; }
  const due = dueBoards(db, { now, limit: opts.budgetBoards ?? 300, families: opts.families, tiers: opts.tiers, keys: opts.keys, localHour: opts.localHour ?? now.getHours() });
  const summary: TickSummary = { boards: 0, inserted: 0, upgraded: 0, duplicates: 0, visaSkipped: 0, locSkipped: 0, byFamily: {}, errors: [], durationMs: 0 };
  const knownStmt = db.prepare("SELECT 1 FROM jobs WHERE apply_url = ?");
  const isKnownUrl = (u: string) => !!knownStmt.get(u);
  const deadline = started + (opts.budgetMs ?? 90_000);
  const groups = new Map<Family, BoardRow[]>();
  for (const b of due) groups.set(b.family, [...(groups.get(b.family) ?? []), b]);

  const runBoard = async (b: BoardRow, cfg: FamilyConfig) => {
    const fam = (summary.byFamily[b.family] ??= { boards: 0, inserted: 0, errors: 0 });
    fam.boards++; summary.boards++;
    try {
      let rows = await cfg.fetch(b, { fetcher, depth: b.tier === "core" ? "core" : "longtail", isKnownUrl, now, setMeta: (p) => mergeBoardMeta(db, b.key, p) });
      if (cfg.gated && b.origin !== "seed") rows = rows.filter((r) => isEngineeringTitle(r.title));
      const s = upsertJobs(db, rows, { boardKey: b.key });
      summary.inserted += s.inserted; summary.upgraded += s.upgraded; summary.duplicates += s.duplicates;
      summary.visaSkipped += s.visaSkipped; summary.locSkipped += s.locSkipped; fam.inserted += s.inserted;
      for (const e of s.errors) summary.errors.push({ key: b.key, error: e.error });
      markBoardResult(db, b.key, { ok: true, now: new Date(), rand: opts.rand });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const st = msg.match(/HTTP (\d{3})/);
      markBoardResult(db, b.key, { ok: false, error: msg, httpStatus: st ? Number(st[1]) : null, now: new Date(), rand: opts.rand });
      fam.errors++; summary.errors.push({ key: b.key, error: msg });
    }
  };

  await Promise.all([...groups.entries()].map(async ([family, boards]) => {
    const cfg = registry[family];
    if (!cfg) return;
    const queue = [...boards];
    const worker = async () => { while (queue.length && Date.now() < deadline) { await runBoard(queue.shift()!, cfg); if (cfg.minGapMs) await sleep(cfg.minGapMs); } };
    await Promise.all(Array.from({ length: Math.min(cfg.concurrency, queue.length) }, worker));
  }));

  summary.durationMs = Date.now() - started;
  logEvent(db, "scan_tick", { entity: "scanner", payload: summary });
  return summary;
}

// 把目标板块标成到期后跑一次大预算 tick(「立即扫描」、来源页的「问一次」、脚本都用它)。
export async function runSweep(db: DB, opts: TickOptions = {}): Promise<TickSummary> {
  const conds = ["tier <> 'muted'"]; const params: unknown[] = [];
  const inList = (col: string, vals?: string[]) => { if (vals?.length) { conds.push(`${col} IN (${vals.map(() => "?").join(",")})`); params.push(...vals); } };
  inList("tier", opts.tiers); inList("family", opts.families); inList("key", opts.keys);
  db.prepare(`UPDATE boards SET next_due_at = NULL WHERE ${conds.join(" AND ")}`).run(...params);
  return runTick(db, { ...opts, budgetBoards: opts.budgetBoards ?? 5000, budgetMs: opts.budgetMs ?? 10 * 60_000 });
}
```

```ts
// src/scanner/relay.ts
import { DB } from "@/lib/db";
import { tryAcquireMatching, releaseMatching } from "@/matcher/inflight";
import { QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { iso } from "@/scanner/boards";
import { promoteRecentHighScores } from "@/scanner/retier";

export const MATCH_HOURLY_CAP = Number(process.env.MATCH_HOURLY_CAP ?? 1500);
export function matchBudget(db: DB, cap = MATCH_HOURLY_CAP): number {
  const n = (db.prepare("SELECT COUNT(*) n FROM matches WHERE created_at >= datetime('now','-1 hour')").get() as { n: number }).n;
  return Math.max(0, cap - n);
}
export function unscoredBacklog(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) n FROM jobs j JOIN applications a ON a.job_id = j.id LEFT JOIN matches m ON m.job_id = j.id WHERE m.id IS NULL AND ${QUEUE_ELIGIBLE_SQL}`).get() as { n: number }).n;
}

// 入库后的接力(tick / 立即扫描 / Chrome 入库共用):去重 → 匹配(每小时上限)→ 内推建议 → 高分板块升 core → jd_review。
// fire-and-forget;拿不到匹配锁就返回 false,由下一分钟的 tick 再来。
export function startPostScanPipeline(db: DB): boolean {
  if (!tryAcquireMatching()) return false;
  void (async () => {
    try {
      const { loadProfile } = await import("@/lib/profile");
      const { getBackend } = await import("@/llm/registry");
      const { runConsolidate } = await import("@/scanner/consolidate");
      const { runMatching } = await import("@/matcher/run");
      const { runReferralFit } = await import("@/matcher/referral-fit");
      const { maybeStartJdReview } = await import("@/jd-review/relay");
      const profile = loadProfile();
      const backend = getBackend();
      const c = await runConsolidate(db, { backend, groupsPerCall: 15, limitGroups: 20 });
      console.log(`[scan→consolidate] groups ${c.groups}, archived ${c.archived}, errors ${c.errors.length}`);
      const budget = matchBudget(db);
      const since = iso(new Date(Date.now() - 5000));
      if (budget > 0) {
        await runMatching(db, { backend, profile: { directions: profile.directions, work_auth: profile.work_auth }, batchSize: 10, threshold: 40, limit: Math.min(200, budget), concurrency: 6 });
        await runReferralFit(db, { backend, batchSize: 40, limit: 400, concurrency: 4 });
        const promoted = promoteRecentHighScores(db, since);
        if (promoted) console.log(`[scan→retier] promoted ${promoted} boards to core`);
      } else {
        console.log("[scan→match] hourly cap reached, deferring to a later tick");
      }
      console.log("[scan→jd_review]", maybeStartJdReview(db));
    } catch (e) {
      console.error("[scan→match]", e);
    } finally {
      releaseMatching();
    }
  })().catch((e) => console.error("[scan→match] unhandled", e));
  return true;
}
```

```ts
// src/scanner/sources/directory.ts
import { DB } from "@/lib/db";
import { BoardSpec, iso, upsertBoards } from "@/scanner/boards";
export const DIRECTORY_URL = "https://raw.githubusercontent.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/main/data/companies.json";
export interface DirectoryEntry { name: string; slug: string; ats: string; wd?: string; site?: string; host?: string; }
export function directoryToSpecs(entries: DirectoryEntry[]): BoardSpec[] {
  const out: BoardSpec[] = [];
  for (const e of entries) {
    let key: string | null = null;
    switch (e.ats) {
      case "greenhouse": case "lever": case "ashby": key = `${e.ats}:${e.slug.toLowerCase()}`; break;
      case "workday": if (e.wd && e.site) key = `workday:${e.slug.toLowerCase()}.${e.wd}/${e.site}`; break;
      case "smartrecruiters": key = `smartrecruiters:${e.slug}`; break;
      case "oracle": if (e.host && e.site) key = `oracle:${e.host.toLowerCase()}/${e.site}`; break;
      case "workable": key = `workable:${e.slug.toLowerCase()}`; break;
      default: key = null;
    }
    if (key) out.push({ key, company: e.name, origin: "directory" });
  }
  return out;
}
export function importDirectory(db: DB, entries: DirectoryEntry[], opts: { now: Date; spreadHours?: number; rand?: () => number }): { inserted: number; skipped: number } {
  const specs = directoryToSpecs(entries);
  const exists = db.prepare("SELECT 1 FROM boards WHERE key = ?");
  const fresh = specs.filter((s) => !exists.get(s.key));
  const r = upsertBoards(db, fresh);
  const rand = opts.rand ?? Math.random;
  const spread = (opts.spreadHours ?? 72) * 3600_000;
  const upd = db.prepare("UPDATE boards SET next_due_at = ? WHERE key = ?");
  db.transaction(() => { for (const s of fresh) upd.run(iso(new Date(opts.now.getTime() + rand() * spread)), s.key); })();
  return { inserted: r.inserted, skipped: specs.length - fresh.length };
}
```

`run.ts`:

```ts
import { DB, logEvent } from "@/lib/db";
import { runSweep, TickOptions } from "@/scanner/scheduler";
export interface ScanSummary { inserted: number; upgraded: number; duplicates: number; visaSkipped: number; locSkipped: number; sourceErrors: { source: string; error: string }[]; durationMs: number; }
// 「立即扫描」:核心层(含 6 份清单)立刻问一遍。旧返回形状保留给 /api/scan 与 scripts/scan.ts。
export async function runScan(db: DB, opts: TickOptions = {}): Promise<ScanSummary> {
  const t = await runSweep(db, { tiers: ["core"], ...opts });
  const summary: ScanSummary = { inserted: t.inserted, upgraded: t.upgraded, duplicates: t.duplicates, visaSkipped: t.visaSkipped, locSkipped: t.locSkipped, sourceErrors: t.errors.map((e) => ({ source: e.key, error: e.error })), durationMs: t.durationMs };
  logEvent(db, "scan_done", { entity: "scanner", payload: summary });
  return summary;
}
```

`src/app/api/scan/route.ts`:去掉 `syncWatchlist`/seed/notify/inflight;`const summary = await runScan(db); if (summary.inserted > 0) startPostScanPipeline(db); return NextResponse.json(summary);`。

`src/app/api/scan/tick/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runTick } from "@/scanner/scheduler";
import { startPostScanPipeline, unscoredBacklog, matchBudget } from "@/scanner/relay";
import { retierAll } from "@/scanner/retier";

let tickInFlight = false;
let lastRetierDay = "";
// 每分钟由 instrumentation.ts 调一次:问到期板块;有新增或有积压且额度未用完就接力;每天 03:xx 重算分级。
export async function POST() {
  if (tickInFlight) return NextResponse.json({ skipped: "tick in flight" });
  tickInFlight = true;
  try {
    const db = getDb();
    const now = new Date();
    const day = now.toDateString();
    let retier: { changed: number } | null = null;
    if (now.getHours() === 3 && lastRetierDay !== day) { lastRetierDay = day; retier = retierAll(db, now); }
    const summary = await runTick(db, { now });
    let pipeline = false;
    if ((summary.inserted > 0 || unscoredBacklog(db) > 0) && matchBudget(db) > 0) pipeline = startPostScanPipeline(db);
    return NextResponse.json({ ...summary, pipeline, retier });
  } finally {
    tickInFlight = false;
  }
}
```

`src/instrumentation.ts`:把 7/13 点逻辑换成 `setInterval(() => fetch(\`http://127.0.0.1:${port}/api/scan/tick\`, { method: "POST" }).catch(...), 60_000)`,日志 `cron registered: scan tick every 60s`。

`consolidate.ts` `pickCanonical`:`r.source === "github_list" ? 1 : 0` 改为 `r.source === "github_list" || r.source === "linkedin" ? 1 : 0`。

`scripts/import-directory.ts`:fetch `DIRECTORY_URL` → `importDirectory(getDb(), entries, { now: new Date() })` → 打印。`scripts/retier.ts`:`retierAll(getDb())`。`scripts/scan.ts`:去掉 syncWatchlist。package.json scripts 加 `"import-directory": "tsx scripts/import-directory.ts"`, `"retier": "tsx scripts/retier.ts"`。

- [ ] **Step 5: 运行通过**;`npx vitest run` 全绿;`npm run build` 通过(tsconfig 需 `resolveJsonModule`,已有,因 scan 路由早已 import json)。
- [ ] **Step 6: Commit**  `git commit -am "feat(scan): minute scheduler over the boards registry, post-scan relay with hourly match cap, directory import, seed boards; scan no longer notifies"`

---

### Task 11: 综合排序 + 发布时间列

**Files:**
- Create: `src/apply/rank.ts`
- Modify: `src/apply/queue.ts`(`QueueSort` 加 `composite`;pagedQueue / takeNextApplication / pendingConfirmations 用 `QUEUE_ORDER_SQL`)、`src/app/api/queue/route.ts`(VALID_SORTS、默认 composite、扁平列表排序)、`src/app/queue/queue-board.tsx`(发布列、排序选项、默认值)
- Test: `tests/rank.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// tests/rank.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { COMPOSITE_SCORE_SQL } from "@/apply/rank";
import { pagedQueue } from "@/apply/queue";
describe("composite ranking", () => {
  it("fresh 80 beats 90-day-old 88 but not fresh 90; NULL posted_at counts as 35 days", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, posted_at) VALUES (?,?,?,?,?)");
    ins.run("a", "A", "fresh80", "greenhouse", new Date().toISOString());
    ins.run("b", "B", "old88", "greenhouse", new Date(Date.now() - 90 * 86_400_000).toISOString());
    ins.run("c", "C", "fresh90", "greenhouse", new Date().toISOString());
    ins.run("d", "D", "null85", "greenhouse", null);
    db.prepare("INSERT INTO applications (job_id, status) VALUES (1,'matched'),(2,'matched'),(3,'matched'),(4,'matched')").run();
    db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (1,'swe_general',80,1),(2,'swe_general',88,1),(3,'swe_general',90,1),(4,'swe_general',85,1)").run();
    const rows = db.prepare(`SELECT j.title, ${COMPOSITE_SCORE_SQL} AS c FROM jobs j JOIN matches m ON m.job_id = j.id ORDER BY c DESC`).all() as { title: string; c: number }[];
    expect(rows.map((r) => r.title)).toEqual(["fresh90", "fresh80", "null85", "old88"]);
    expect(rows.find((r) => r.title === "old88")!.c).toBe(73); expect(rows.find((r) => r.title === "null85")!.c).toBe(78);
    const paged = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 10, sort: "composite" });
    expect(paged.rows.map((r) => r.title)).toEqual(["fresh90", "fresh80", "null85", "old88"]);
  });
});
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// src/apply/rank.ts
// 综合分 = Claude 分数 − 时间惩罚:发布 7 天内不扣,之后每 4 天扣 1,封顶 15;无发布日期按 35 天算(扣 7)。
// 只影响排序,不改 matches.score;页面仍显示原始分。
export const COMPOSITE_SCORE_SQL =
  "(m.score - MIN(15, MAX(0, CAST((julianday('now') - COALESCE(julianday(j.posted_at), julianday('now','-35 days')) - 7) / 4 AS INTEGER))))";
export const QUEUE_ORDER_SQL = `COALESCE(m.tier, 9) ASC, ${COMPOSITE_SCORE_SQL} DESC, m.score DESC, j.created_at DESC`;
```
queue.ts:`export type QueueSort = "composite" | "score" | "fresh" | "company"`;pagedQueue 的 `secondarySort`:`composite` → `QUEUE_ORDER_SQL`,`score` 保持原样;`takeNextApplication` / `pendingConfirmations` / `queueByDirection`(若有)ORDER BY 换成 `a.pinned DESC, ${QUEUE_ORDER_SQL}`(pendingConfirmations 无 pinned 则 `QUEUE_ORDER_SQL`)。api/queue/route.ts:`VALID_SORTS = ["composite","score","fresh","company"]`,默认 `composite`,扁平列表 `ORDER BY ${QUEUE_ORDER_SQL}`。

queue-board.tsx:
- `initialSort` 默认 `"composite"`;第 170–171 行 `wasDefault` 的默认值 direction tab 用 `"composite"`。
- 排序下拉:`<option value="composite">综合</option><option value="score">分数</option><option value="fresh">{isAllTab ? "入库时间" : "新鲜度"}</option><option value="company">公司名</option>`。
- 方向 tab 表头加 `<th>发布</th>`(位于「地点」后),单元格:

```tsx
function relDays(iso: string | null): { label: string; fresh: boolean } {
  if (!iso) return { label: "—", fresh: false };
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(d)) return { label: "—", fresh: false };
  return { label: d <= 0 ? "今天" : d === 1 ? "昨天" : `${d} 天前`, fresh: d <= 3 };
}
// <td className="mono" title={r.posted_at ?? undefined} style={{ whiteSpace: "nowrap" }}>{relDays(r.posted_at).label}{relDays(r.posted_at).fresh && <span className="chip text-good" style={{ marginLeft: 4 }}>新</span>}</td>
```
`colSpan` 从 `isAllTab ? 6 : 5` 改为 `isAllTab ? 6 : 6`。

- [ ] **Step 4: 运行通过**;`npm run build`。 **Step 5: Commit**  `git commit -am "feat(queue): composite freshness-aware ranking and posted-date column"`

---

### Task 12: `/sources` 来源页与 API

**Files:**
- Create: `src/scanner/sources-view.ts`、`src/app/api/sources/route.ts`、`src/app/api/sources/board/route.ts`、`src/app/api/sources/poll/route.ts`、`src/app/api/sources/import-directory/route.ts`、`src/app/sources/page.tsx`、`src/app/sources/sources-board.tsx`
- Modify: `src/app/nav-links.tsx`(加 `{ href: "/sources", label: "来源" }`,放在「职位」之后)
- Test: `tests/sources-view.test.ts`

**Interfaces:**
- `sourcesSummary(db): { families: FamilySummary[]; lastTick: {at, payload} | null }`,`FamilySummary = { family; core; longtail; dormant; muted; jobs30; ge75_30; errors24h }`
- `pagedBoards(db, {family?, tier?, q?, page, pageSize}): { rows: (BoardRow & {jobs30; ge75_30})[]; total; pages }`
- `recentBoardEvents(db, limit=50): {at, key, from, to, reason}[]`(kind=board_retier)+ 最近错误(boards.last_error 非空,按 last_polled_at)

- [ ] **Step 1: 失败测试**

```ts
// tests/sources-view.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { upsertBoards, markBoardResult, setBoardTier } from "@/scanner/boards";
import { sourcesSummary, pagedBoards, recentBoardEvents } from "@/scanner/sources-view";
describe("sources view", () => {
  it("summarizes per family and pages boards with filters", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:a", company: "A", origin: "seed" }, { key: "greenhouse:b", company: "B", origin: "url" }, { key: "workday:t.wd1/s", company: "T", origin: "directory" }]);
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES ('x','A','SWE','greenhouse','greenhouse:a')").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 80)").run();
    markBoardResult(db, "greenhouse:b", { ok: false, error: "HTTP 500", httpStatus: 500, now: new Date() });
    setBoardTier(db, "workday:t.wd1/s", "muted");
    const s = sourcesSummary(db);
    const gh = s.families.find((f) => f.family === "greenhouse")!;
    expect(gh).toMatchObject({ core: 1, longtail: 1, jobs30: 1, ge75_30: 1, errors24h: 1 });
    expect(s.families.find((f) => f.family === "workday")).toMatchObject({ muted: 1 });
    expect(pagedBoards(db, { family: "greenhouse", page: 1, pageSize: 50 }).rows.map((r) => r.key)).toEqual(["greenhouse:a", "greenhouse:b"]);
    expect(pagedBoards(db, { q: "T", page: 1, pageSize: 50 }).total).toBe(1);
    expect(pagedBoards(db, { tier: "muted", page: 1, pageSize: 50 }).total).toBe(1);
    expect(recentBoardEvents(db)[0]).toMatchObject({ key: "workday:t.wd1/s", to: "muted", reason: "user" });
  });
});
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```ts
// src/scanner/sources-view.ts
import { DB } from "@/lib/db";
import { BoardRow, Tier } from "@/scanner/boards";
import { Family } from "@/scanner/board-key";

export interface FamilySummary { family: Family; core: number; longtail: number; dormant: number; muted: number; jobs30: number; ge75_30: number; errors24h: number; }
export function sourcesSummary(db: DB): { families: FamilySummary[]; lastTick: { at: string; payload: unknown } | null } {
  const families = db.prepare(
    `SELECT b.family,
       SUM(b.tier='core') core, SUM(b.tier='longtail') longtail, SUM(b.tier='dormant') dormant, SUM(b.tier='muted') muted,
       SUM(b.last_error IS NOT NULL AND b.last_polled_at >= datetime('now','-1 day')) errors24h,
       COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.board_key IN (SELECT key FROM boards WHERE family=b.family) AND j.created_at >= datetime('now','-30 days')),0) jobs30,
       COALESCE((SELECT COUNT(*) FROM jobs j JOIN matches m ON m.job_id=j.id WHERE j.board_key IN (SELECT key FROM boards WHERE family=b.family) AND j.created_at >= datetime('now','-30 days') AND m.score>=75),0) ge75_30
     FROM boards b GROUP BY b.family ORDER BY ge75_30 DESC, jobs30 DESC`
  ).all() as FamilySummary[];
  const t = db.prepare("SELECT at, payload FROM events WHERE kind='scan_tick' ORDER BY id DESC LIMIT 1").get() as { at: string; payload: string } | undefined;
  return { families, lastTick: t ? { at: t.at, payload: JSON.parse(t.payload) } : null };
}

export interface PagedBoardsOpts { family?: string; tier?: Tier; q?: string; page: number; pageSize: number; }
export type BoardView = BoardRow & { jobs30: number; ge75_30: number };
export function pagedBoards(db: DB, o: PagedBoardsOpts): { rows: BoardView[]; total: number; pages: number } {
  const conds: string[] = []; const params: unknown[] = [];
  if (o.family) { conds.push("b.family = ?"); params.push(o.family); }
  if (o.tier) { conds.push("b.tier = ?"); params.push(o.tier); }
  if (o.q) { conds.push("(b.company LIKE ? OR b.key LIKE ?)"); params.push(`%${o.q}%`, `%${o.q}%`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) n FROM boards b ${where}`).get(...params) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / o.pageSize));
  const page = Math.min(Math.max(1, o.page), pages);
  const rows = db.prepare(
    `SELECT b.*,
       (SELECT COUNT(*) FROM jobs j WHERE j.board_key=b.key AND j.created_at >= datetime('now','-30 days')) jobs30,
       (SELECT COUNT(*) FROM jobs j JOIN matches m ON m.job_id=j.id WHERE j.board_key=b.key AND j.created_at >= datetime('now','-30 days') AND m.score>=75) ge75_30
     FROM boards b ${where}
     ORDER BY CASE b.tier WHEN 'core' THEN 0 WHEN 'longtail' THEN 1 WHEN 'dormant' THEN 2 ELSE 3 END, ge75_30 DESC, jobs30 DESC, b.company COLLATE NOCASE ASC, b.key ASC
     LIMIT ? OFFSET ?`
  ).all(...params, o.pageSize, (page - 1) * o.pageSize) as BoardView[];
  return { rows, total, pages };
}

export function recentBoardEvents(db: DB, limit = 50): { at: string; key: string; from: string; to: string; reason: string }[] {
  const rows = db.prepare("SELECT at, payload FROM events WHERE kind='board_retier' ORDER BY id DESC LIMIT ?").all(limit) as { at: string; payload: string }[];
  return rows.map((r) => { const p = JSON.parse(r.payload) as { key: string; from: string; to: string; reason: string }; return { at: r.at, ...p }; });
}
```

API 路由:
- `GET /api/sources?family=&tier=&q=&page=` → `{ ...sourcesSummary(db), ...pagedBoards(db, {...}), events: recentBoardEvents(db) }`。
- `PATCH /api/sources/board` body `{key, tier}`(zod:tier ∈ TIERS)→ `setBoardTier` → `{ok:true}`。
- `POST /api/sources/poll` body `{key}` → `runSweep(db, {keys:[key], budgetBoards: 1})` → 若 inserted>0 `startPostScanPipeline` → 返回 TickSummary。
- `POST /api/sources/import-directory` → fetch `DIRECTORY_URL`(AbortSignal.timeout 30s)→ `importDirectory(db, entries, {now: new Date()})` → `{inserted, skipped}`。

页面 `src/app/sources/page.tsx`(server,`dynamic = "force-dynamic"`):标题「来源」+ `<SourcesBoard />`。`sources-board.tsx`("use client"):
- state:filters {family, tier, q, page}、data、busy;`useEffect` 拉 `/api/sources`。
- 顶部 `section.panel`:family 汇总表(family / core / longtail / dormant / muted / 30 天新岗 / 30 天 ≥75 / 24h 错误);右上按钮:「立即扫描」(POST /api/scan)、「Chrome 扫描」(计划二接入;本任务先不渲染)、「导入开源目录」(POST /api/sources/import-directory,完成后 alert 显示数量并刷新)。上次 tick 时间 + 摘要一行。
- 板块表:公司(下面小字 key)、family、tier `<select>`(onChange → PATCH)、上次问(last_polled_at 相对时间;last_error 用 `text-accent` 显示前 60 字)、30 天新岗、30 天 ≥75、操作:「问一次」(POST poll)、「静音/恢复」(PATCH tier muted / longtail)。筛选:family `<select>`(FAMILIES)、tier `<select>`、搜索框、分页(复用 `.pagination`)。
- 最近事件列表(50 条):`at key from → to (reason)`。

- [ ] **Step 4: 运行通过**;`npm run build`;dev 起服务用浏览器面板打开 `/sources` 确认渲染与按钮可点(见 verification_workflow)。
- [ ] **Step 5: Commit**  `git commit -am "feat(sources): /sources page and APIs — per-family yield, board table with tier/mute/poll, directory import"`

---

### Task 13: 文档、脚本、全量验证

**Files:**
- Modify: `CLAUDE.md`(§0 状态、§2 架构图扫描部分、§4 待办、§5 数据路径)、`README.md`「自动扫描」
- Modify: `.claude/skills/apply-executor/SKILL.md`(若引用 7:00/13:00 扫描,改为每分钟 tick;LinkedIn 来源的 applyUrl 是 LinkedIn 职位页,需在 Chrome 里点 Apply 跳转)

- [ ] **Step 1: CLAUDE.md** §2 扫描一段改写:`扫描 src/scanner/(boards 注册表:种子 config/boards.seed.json + 从岗位 URL 自动发现 + 开源目录导入;适配器 sources/<family>.ts:greenhouse/lever/ashby/workday/bytedance/smartrecruiters/oracle/icims/workable/amazon/linkedin 游客/6 份 GitHub 清单;scheduler.ts 每分钟 tick(instrumentation.ts → POST /api/scan/tick),core 每小时 / longtail 每天 / dormant 每周,按 90 天产出 retier;不通知)→ …`。§4 加「信息源优化(2026-09-06)已合入并部署;目录导入需在 /sources 点一次;LinkedIn 游客接口限流会自动退避;Chrome 扫描 run 见 §3.12」。
- [ ] **Step 2: README** 「自动扫描」改写为来源层说明 + `/sources` 用法 + `npm run import-directory` / `npm run retier`。
- [ ] **Step 3: 全量**  `npx vitest run`(全绿)→ `npm run build` → commit `docs: sources layer in CLAUDE.md/README`。

---

## Self-review(写完后核对)

- 覆盖:§1 数据模型 → Task 2/4;§2 适配器 11 种 → Task 5–9(icims/linkedin 8,lists 9,amazon/bytedance 6,sr/oracle/workable 7,workday 5,gh/lever/ashby 包装 5);工程标题门 → Task 4 + scheduler;种子/方向补缺 → Task 10;§3 调度/接力/首次铺开/retier/不通知 → Task 10;§5.1 来源页 → Task 12;§5.2 排序与发布列 → Task 11;§6 测试 → 各任务;迁移与上线 → Task 2 + 计划二收尾。
- 类型一致:`FetchCtx`/`Registry`/`FamilyConfig` 定义于 `sources/types.ts`,`index.ts` re-export;`BoardRow.tier: Tier`;`upsertJobs` 返回 `errors` 字段(非 `sourceErrors`),`runScan` 转成 `sourceErrors`。
- 未决:Rippling/BambooHR 不做(spec §7)。
