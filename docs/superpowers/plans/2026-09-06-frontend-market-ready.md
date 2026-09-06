# Sortie 前端「市场级」重做 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Sortie 的 8 个页面重做成面向市场用户的产品级前端:清晰的信息架构(首页收件箱)、成熟的「制版间」设计系统、产品化文案、完整的加载/空态/错误/撤销处理、手机可用;后端协议不变。

**Architecture:** Next.js 15 App Router 不变:页面 server component 首屏取数 + 客户端组件轮询。新增一层 `src/app/components/ui/*` 组件库与 `src/app/styles/*.css` 五文件设计系统;`src/app/lib/*` 放客户端安全的纯逻辑(标签映射、时间、计划构造、日志分类),用 vitest 直接测。后端只加三样只读能力:`GET /api/overview`(角标与首页数字)、`GET /api/queue?q=`(搜索)、`GET /api/settings`(ntfy 是否配置)。

**Tech Stack:** Next.js 15、React 19、纯 CSS(custom properties)、`lucide-react`(唯一新依赖)、vitest。

**Spec:** `docs/superpowers/specs/2026-09-06-frontend-market-ready-design.md`

**执行说明:** 本计划由同一个会话内联执行(用户不在线)。纯逻辑任务给出完整测试与实现代码;UI 组件任务给出 props 接口、CSS 类契约与 JSX 骨架,完整 JSX/CSS 按 spec §4 的设计系统在执行时写出。每个任务结束都要 `npm test` 绿、`npx tsc --noEmit` 干净、提交一次。

## Global Constraints

- 不改任何 POST 接口语义、不改 schema、不改扫描/匹配/执行器逻辑(spec §7、§9)。
- 界面禁用词(spec §5):值守会话 / 执行器 / run(单独出现)/ user_chrome / headless / pid / profile.yaml / sqlite / claude-in-chrome / 答案包 / 英文 slug / 英文 kind;统一叫「助手」「任务」「在我的 Chrome 里操作」「后台浏览器」。
- 所有颜色只经 tokens;圆角 0;字体 Newsreader / IBM Plex Sans / JetBrains Mono 不变。
- 没有 `window.prompt/confirm/alert`,没有 `location.reload()`。
- 说明文字 ≤ 1 行;更多进 `Tooltip` 或 `<details>`。
- 单个 TSX 文件 ≤ 400 行。
- 开发验证:`.claude/launch.json` 的 `worktree-dev-3001`(端口 3001,`SCAN_TICK_DISABLED=1`,`data/jobseeker.db` 为快照,与生产库隔离)。生产库在主检出,合并前不碰。
- 提交信息以 `ui:` / `feat(ui):` / `feat(api):` / `test:` / `docs:` 开头,末尾带 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

## 文件结构

```
src/app/
  layout.tsx                 壳:字体、metadata、主题脚本、<Providers><AppShell>
  globals.css                只 @import styles/*.css
  styles/tokens.css          颜色/间距/字号/阴影/动效变量,浅色 + 深色
  styles/base.css            重置、元素默认、排版、焦点、reduced-motion
  styles/shell.css           侧栏、顶栏、内容区、手机导航
  styles/components.css      .btn .chip .card .section .stat .field .tabs .seg .menu .dialog .drawer .toast .skeleton .empty .tooltip .table
  styles/pages.css           页面专属:.job-row .job-drawer .plan-table .confirm-card .referral-card .contact-list .timeline .resume-grid
  icon.svg                   站点图标
  error.tsx / not-found.tsx / loading.tsx
  page.tsx                   今日(server)→ today/today-client.tsx
  today/today-client.tsx     收件箱 + 助手卡 + 数字条 + 快捷操作
  components/
    providers.tsx            ToastProvider + OverviewProvider
    overview-context.tsx     每 5s GET /api/overview;useOverview()
    shell/nav.ts             导航项(href/label/icon/badge)
    shell/app-shell.tsx      侧栏 + 顶栏 + 手机抽屉导航 + 助手胶囊
    shell/theme-script.tsx   首屏内联主题脚本
    assistant-card.tsx       AssistantCard(full/compact)+ RunStepsDialog + AssistantPill
    scan-menu.tsx            「扫描 ▾」:立即扫描 / 在我的 Chrome 里扫描
    ui/*.tsx                 button chip card stat field tabs segmented menu dialog drawer toast skeleton empty-state tooltip relative-time page-header index
  lib/
    labels.ts  time.ts  plan.ts  log-steps.ts  describe-run.ts  answer-labels.ts  settings.ts  api.ts
  queue/page.tsx  queue/queue-client.tsx  queue/job-row.tsx  queue/job-drawer.tsx  queue/loading.tsx
  apply/page.tsx  apply/plan-card.tsx  apply/confirm-cards.tsx  apply/info-cards.tsx  apply/referral-board.tsx
  apply/referral-contact.tsx  apply/referral-won-dialog.tsx  apply/manual-list.tsx  apply/today-submitted.tsx  apply/loading.tsx
  history/page.tsx  history/history-client.tsx  history/stage-menu.tsx  history/history-sankey.tsx  history/loading.tsx
  network/page.tsx  network/network-client.tsx  network/drafts-cards.tsx  network/contacts-pane.tsx
  network/contact-detail.tsx  network/person-dialog.tsx  network/draft-dialog.tsx  network/loading.tsx
  profile/page.tsx  profile/profile-tabs.tsx  profile/experiences-tab.tsx  profile/experience-dialog.tsx
  profile/resumes-tab.tsx  profile/answers-tab.tsx  profile/loading.tsx
  studio/page.tsx            redirect → /profile?tab=resumes
  dashboard/page.tsx  dashboard/loading.tsx
  settings/page.tsx  settings/settings-client.tsx
  sources/page.tsx  sources/sources-board.tsx
  api/overview/route.ts  api/settings/route.ts
src/apply/overview.ts        overview(db)
src/apply/queue.ts           pagedQueue/pagedAllJobs 加 q
tests/ui-labels.test.ts  tests/ui-time.test.ts  tests/ui-plan.test.ts  tests/ui-log-steps.test.ts
tests/overview.test.ts  tests/apply-queue-search.test.ts
删除:components/mode-filter.tsx、components/executor-panel.tsx、components/chrome-scan-button.tsx、queue/scan-button.tsx、queue/queue-board.tsx、apply/quota-table.tsx、apply/confirm-panel.tsx、apply/info-panel.tsx、apply/referral-panel.tsx、apply/unpark-button.tsx、history/history-board.tsx、profile/experience-editor.tsx、profile/standard-answers-editor.tsx、studio/generate-panel.tsx
```

---

# 阶段 P0:设计系统与壳

### Task P0.1: 纯逻辑模块 `src/app/lib/*`(带测试)

**Files:**
- Create: `src/app/lib/labels.ts`、`src/app/lib/time.ts`、`src/app/lib/plan.ts`、`src/app/lib/log-steps.ts`、`src/app/lib/describe-run.ts`、`src/app/lib/answer-labels.ts`、`src/app/lib/settings.ts`、`src/app/lib/api.ts`
- Test: `tests/ui-labels.test.ts`、`tests/ui-time.test.ts`、`tests/ui-plan.test.ts`、`tests/ui-log-steps.test.ts`

**Interfaces (Produces):**

```ts
// labels.ts — 全部客户端安全(不 import db)
export const RUN_STATUS_LABEL: Record<string, string>;   // queued 排队中 / running 进行中 / done 已完成 / failed 失败 / stopped 已停止
export const RUN_KIND_LABEL: Record<string, string>;     // apply 投递 / network_send 发消息 / network_find 找人 / jd_review 补正文 / scan Chrome 扫描 / referral_check 检查内推回复
export const CHANNEL_LABEL: Record<string, string>;      // user_chrome 在我的 Chrome 里 / headless 后台浏览器
export const EXPERIENCE_KIND_LABEL: Record<string, string>; // education 教育 / work 工作 / project 项目 / skill 技能 / award 奖项 / publication 论文
export const SPONSORSHIP_LABEL, DEGREE_LABEL, ROLE_KIND_LABEL, JD_STATUS_LABEL: Record<string, string>;
export const OUTREACH_STATUS_LABEL, REFERRAL_STAGE_LABEL: Record<string, string>;
export const REFERRAL_STAGE_TONE: Record<string, "neutral"|"good"|"warn"|"danger"|"info">;
export const RELATION_LABEL, PLAYBOOK_LABEL, MSG_CHANNEL_LABEL: Record<string, string>;
export function labelOf(map: Record<string,string>, key: string | null | undefined, fallback = "—"): string;
export function tierLabel(tier: number | null | undefined): string;   // "梯队 1" / "未分梯队"
export function modeLabel(mode: "referral"|"direct"|null|undefined, fit?: number|null): string; // 内推 / 海投 / 未判定

// time.ts
export function parseSqliteUtc(ts: string | null | undefined): Date | null;   // "YYYY-MM-DD HH:MM:SS"(UTC 无标记)或 ISO
export function relativeDays(iso: string | null, now?: number): { label: string; days: number | null; fresh: boolean }; // 今天/昨天/N 天前;fresh = days ≤ 3;null → "—"
export function relativeTime(ts: string | null, now?: number): string;  // 刚刚 / N 分钟前 / N 小时前 / N 天前 / "—"
export function localShort(ts: string | null): string;                  // "MM-DD HH:MM" 本地
export function minutesSince(ts: string, now?: number): number;
export function formatDateZh(d: Date): string;                          // "9 月 6 日 · 周日"

// plan.ts
export type ApplyMode = "referral" | "direct";
export interface PlanEntry { direction: string; count: number; mode: ApplyMode }
export type PlanCounts = Record<string, { referral: number; direct: number }>;
export function clampCount(value: unknown, max: number): number;        // 非数/负 → 0;向下取整;≤ max
export function buildPlan(order: string[], counts: PlanCounts): PlanEntry[]; // 先所有 referral(按 order)再所有 direct;跳过 0
export function planTotals(counts: PlanCounts): { referral: number; direct: number; total: number };

// log-steps.ts
export type StepKind = "info" | "ok" | "wait" | "warn" | "error";
export interface LogStep { at: string | null; text: string; kind: StepKind }
export function parseLogLine(line: string): LogStep;   // 去掉前缀 "[HH:MM:SS] ";关键词分类
export function parseLog(lines: string[]): LogStep[];

// describe-run.ts
export function describeRun(kind: string, options: unknown): string;   // "SWE (General) ×2 · MLE / Applied ML·内推 ×1" / "恢复模式" / "前 40 个" / "找内推 岗位 #12,#13"

// answer-labels.ts
export const ANSWER_LABELS: Record<string, { label: string; hint?: string }>;
export function answerLabel(key: string): string;   // 未知 key 原样返回

// settings.ts(仅客户端)
export type Channel = "user_chrome" | "headless"; export type Theme = "light" | "dark" | "system";
export function getChannel(): Channel; export function setChannel(c: Channel): void;
export function getTheme(): Theme; export function setTheme(t: Theme): void; export function applyTheme(t: Theme): void;

// api.ts
export class ApiError extends Error { status: number }
export async function getJson<T>(url: string): Promise<T>;
export async function postJson<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T>;
export async function putJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T>;
export async function patchJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T>;
export async function deleteJson<T = Record<string, unknown>>(url: string): Promise<T>;
```

- [ ] **Step 1: 写失败测试**

```ts
// tests/ui-labels.test.ts
import { describe, it, expect } from "vitest";
import { labelOf, RUN_STATUS_LABEL, EXPERIENCE_KIND_LABEL, tierLabel, modeLabel, SPONSORSHIP_LABEL } from "@/app/lib/labels";
describe("ui labels", () => {
  it("maps known keys and falls back for unknown", () => {
    expect(labelOf(RUN_STATUS_LABEL, "running")).toBe("进行中");
    expect(labelOf(RUN_STATUS_LABEL, "bogus")).toBe("—");
    expect(labelOf(RUN_STATUS_LABEL, "bogus", "bogus")).toBe("bogus");
    expect(labelOf(EXPERIENCE_KIND_LABEL, "work")).toBe("工作");
    expect(labelOf(SPONSORSHIP_LABEL, "no")).toBe("不提供签证");
  });
  it("tier and mode labels", () => {
    expect(tierLabel(1)).toBe("梯队 1");
    expect(tierLabel(null)).toBe("未分梯队");
    expect(modeLabel("referral")).toBe("内推");
    expect(modeLabel("direct", 0)).toBe("海投");
    expect(modeLabel("direct", null)).toBe("未判定");
  });
});
```

```ts
// tests/ui-time.test.ts
import { describe, it, expect } from "vitest";
import { parseSqliteUtc, relativeDays, relativeTime, minutesSince, formatDateZh } from "@/app/lib/time";
describe("ui time", () => {
  const now = Date.parse("2026-09-06T20:00:00Z");
  it("parses sqlite UTC and ISO", () => {
    expect(parseSqliteUtc("2026-09-06 19:30:00")!.toISOString()).toBe("2026-09-06T19:30:00.000Z");
    expect(parseSqliteUtc("2026-09-06T19:30:00Z")!.toISOString()).toBe("2026-09-06T19:30:00.000Z");
    expect(parseSqliteUtc(null)).toBeNull();
    expect(parseSqliteUtc("nope")).toBeNull();
  });
  it("relativeDays: 今天/昨天/N 天前, fresh within 3 days", () => {
    expect(relativeDays("2026-09-06T10:00:00Z", now)).toEqual({ label: "今天", days: 0, fresh: true });
    expect(relativeDays("2026-09-05T10:00:00Z", now)).toEqual({ label: "昨天", days: 1, fresh: true });
    expect(relativeDays("2026-08-30T10:00:00Z", now).label).toBe("7 天前");
    expect(relativeDays("2026-08-30T10:00:00Z", now).fresh).toBe(false);
    expect(relativeDays(null, now)).toEqual({ label: "—", days: null, fresh: false });
  });
  it("relativeTime and minutesSince accept sqlite UTC", () => {
    expect(relativeTime("2026-09-06 19:59:40", now)).toBe("刚刚");
    expect(relativeTime("2026-09-06 19:30:00", now)).toBe("30 分钟前");
    expect(relativeTime("2026-09-06 15:00:00", now)).toBe("5 小时前");
    expect(relativeTime("2026-09-01 15:00:00", now)).toBe("5 天前");
    expect(minutesSince("2026-09-06 19:30:00", now)).toBe(30);
  });
  it("formatDateZh", () => {
    expect(formatDateZh(new Date(2026, 8, 6))).toBe("9 月 6 日 · 周日");
  });
});
```

```ts
// tests/ui-plan.test.ts
import { describe, it, expect } from "vitest";
import { buildPlan, clampCount, planTotals } from "@/app/lib/plan";
describe("apply plan", () => {
  it("clamps", () => {
    expect(clampCount("3", 5)).toBe(3);
    expect(clampCount(9, 5)).toBe(5);
    expect(clampCount(-1, 5)).toBe(0);
    expect(clampCount("x", 5)).toBe(0);
    expect(clampCount(2.7, 5)).toBe(2);
  });
  it("orders referral entries first, keeps direction order, skips zeros", () => {
    const plan = buildPlan(["mle", "swe_general"], { mle: { referral: 0, direct: 2 }, swe_general: { referral: 1, direct: 3 } });
    expect(plan).toEqual([
      { direction: "swe_general", count: 1, mode: "referral" },
      { direction: "mle", count: 2, mode: "direct" },
      { direction: "swe_general", count: 3, mode: "direct" },
    ]);
    expect(planTotals({ mle: { referral: 0, direct: 2 }, swe_general: { referral: 1, direct: 3 } })).toEqual({ referral: 1, direct: 5, total: 6 });
  });
});
```

```ts
// tests/ui-log-steps.test.ts
import { describe, it, expect } from "vitest";
import { parseLogLine } from "@/app/lib/log-steps";
describe("log steps", () => {
  it("strips the timestamp prefix and classifies", () => {
    expect(parseLogLine("[14:34:31] 接单 apply run #25:计划 swe_general ×2")).toEqual({ at: "14:34:31", text: "接单 apply run #25:计划 swe_general ×2", kind: "info" });
    expect(parseLogLine("[14:40:00] 已提交,看到成功页").kind).toBe("ok");
    expect(parseLogLine("[14:40:00] 等待用户确认(心跳)").kind).toBe("wait");
    expect(parseLogLine("[14:40:00] 跳过:明确不 sponsor,报 needs_manual").kind).toBe("warn");
    expect(parseLogLine("[14:40:00] 失败:页面打不开").kind).toBe("error");
    expect(parseLogLine("no prefix line")).toEqual({ at: null, text: "no prefix line", kind: "info" });
  });
});
```

- [ ] **Step 2: 运行确认失败** `npx vitest run tests/ui-*.test.ts` → 模块不存在。

- [ ] **Step 3: 实现**(要点)

```ts
// time.ts 核心
export function parseSqliteUtc(ts) {
  if (!ts) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? `${ts.replace(" ", "T")}Z` : ts;
  const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d;
}
export function relativeDays(iso, now = Date.now()) {
  const d = parseSqliteUtc(iso); if (!d) return { label: "—", days: null, fresh: false };
  const days = Math.max(0, Math.floor((now - d.getTime()) / 86_400_000));
  return { label: days === 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`, days, fresh: days <= 3 };
}
export function relativeTime(ts, now = Date.now()) {
  const d = parseSqliteUtc(ts); if (!d) return "—";
  const m = Math.floor((now - d.getTime()) / 60_000);
  if (m < 1) return "刚刚"; if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
export function formatDateZh(d) { return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${"日一二三四五六"[d.getDay()]}`; }
```

```ts
// log-steps.ts 分类规则(按顺序命中第一条)
const RULES: [StepKind, RegExp][] = [
  ["error", /失败|错误|error|异常|验证码|限流/i],
  ["warn", /跳过|needs_manual|需人工|归档|超时|不合格|拦下/],
  ["wait", /等待|心跳|轮询|等你|排队/],
  ["ok", /已提交|成功|完成|已发出|已发送|批准/],
];
export function parseLogLine(line) {
  const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s?(.*)$/s);
  const at = m ? m[1] : null; const text = m ? m[2] : line;
  const kind = RULES.find(([, re]) => re.test(text))?.[0] ?? "info";
  return { at, text, kind };
}
```

`describe-run.ts` 把现有 `executor-panel.tsx` 的 `describeOptions` 搬过来,方向 slug 经 `directionLabel()` 显示。`answer-labels.ts` 收录 `standard-answers-editor.tsx` 的 SUGGESTED 九个 key + `city / start_date / location_preference / offer_deadline / engineering_preference`(profile.yaml 里已有的);`settings.ts` 用 `try/catch` 包 `localStorage`;`api.ts` 在非 2xx 时 `throw new ApiError(json.error ?? \`HTTP ${status}\`, status)`。

- [ ] **Step 4: 跑测试** `npx vitest run tests/ui-*.test.ts` → PASS;`npx tsc --noEmit`。
- [ ] **Step 5: Commit** `git commit -m "feat(ui): client-safe label/time/plan/log helpers"`

---

### Task P0.2: 只读接口 `GET /api/overview` 与 `GET /api/settings`

**Files:**
- Create: `src/apply/overview.ts`、`src/app/api/overview/route.ts`、`src/app/api/settings/route.ts`
- Test: `tests/overview.test.ts`

**Interfaces (Produces):**

```ts
// src/apply/overview.ts
export interface OverviewCounts {
  awaitingConfirm: number;   // applications.status='awaiting_confirm'
  approvedWaiting: number;   // 其中 confirm_decision='approved'
  needsInfo: number;         // pendingInfo(db).length
  referralDrafts: number;    // outreach status='draft' 且 job-linked(JOB_LINKED_SQL)
  referralProgress: number;  // referralBoard 中 stage ∈ {will_refer, referred} 的联系人数
  referralInFlight: number;  // referralBoard 全部岗位数
  networkDrafts: number;     // outreach status='draft' 且非 job-linked
  networkPendingSend: number;// outreach status='pending_send' 且非 job-linked
  manual: number;            // status='matched' AND needs_manual_reason NOT NULL AND pending_questions IS NULL
  queueMatched: number;      // Σ queueByDirection().matched
  submittedToday: number;    // todaySubmitted(db).length
  submittedThisWeek: number; // weekly(db).thisWeek.submittedApplications
}
export interface Overview {
  today: string;                       // 本地 "YYYY-MM-DD"
  assistant: RunStatusRow | null;      // 首个 queued|running 的 run,否则最近一条,否则 null(含 logTail)
  counts: OverviewCounts;
}
export function overview(db: DB): Overview;
export function attentionTotal(c: OverviewCounts): number; // awaitingConfirm - approvedWaiting + needsInfo + referralDrafts + referralProgress
```

`GET /api/overview` → `Overview`;`GET /api/settings` → `{ ntfyConfigured: boolean }`(`!!process.env.NTFY_TOPIC`)。

- [ ] **Step 1: 失败测试**

```ts
// tests/overview.test.ts
import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { overview, attentionTotal } from "@/apply/overview";
import { upsertPerson, createOutreach } from "@/network/crm";

function seedJob(db: DB, status: string, extra: Partial<{ confirm_decision: string; needs_manual_reason: string; submitted_at: string }> = {}) {
  const jobId = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, "Acme", "SWE", "manual", "https://acme.example/apply").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "swe_general", 80, 1);
  db.prepare("INSERT INTO applications (job_id, status, confirm_decision, needs_manual_reason, submitted_at) VALUES (?,?,?,?,?)")
    .run(jobId, status, extra.confirm_decision ?? null, extra.needs_manual_reason ?? null, extra.submitted_at ?? null);
  return jobId;
}

describe("overview", () => {
  it("counts the decision inbox, queue and submissions", () => {
    const db = openDb(":memory:");
    seedJob(db, "matched");
    seedJob(db, "matched");
    seedJob(db, "awaiting_confirm");
    seedJob(db, "awaiting_confirm", { confirm_decision: "approved" });
    seedJob(db, "matched", { needs_manual_reason: "login wall" });
    seedJob(db, "submitted", { submitted_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    const personId = upsertPerson(db, { name: "Pat", company: "Acme", source: "manual" });
    createOutreach(db, { personId, playbook: "coffee_chat", channel: "linkedin", draft: "hi" }); // status draft, not job-linked
    const o = overview(db);
    expect(o.counts).toMatchObject({
      awaitingConfirm: 2, approvedWaiting: 1, needsInfo: 0, manual: 1,
      networkDrafts: 1, networkPendingSend: 0, queueMatched: 2, submittedToday: 1, submittedThisWeek: 1,
      referralDrafts: 0, referralInFlight: 0, referralProgress: 0,
    });
    expect(o.assistant).toBeNull();
    expect(o.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(attentionTotal(o.counts)).toBe(1);
  });
});
```

(若 `createOutreach` 的输入字段名与上面不同,以 `src/network/crm.ts` 的 `OutreachInputSchema` 为准改测试。)

- [ ] **Step 2: 确认失败** → **Step 3: 实现**(用 `pendingInfo`、`referralBoard`、`queueByDirection`、`todaySubmitted`、`weekly`、`executorStatus`、`JOB_LINKED_SQL` 组合;`today` 用本地时间 `new Date()` 的 `YYYY-MM-DD`)→ **Step 4: `npx vitest run tests/overview.test.ts`** → **Step 5: Commit** `feat(api): read-only /api/overview and /api/settings for the app shell`

---

### Task P0.3: 队列搜索参数 `q`

**Files:**
- Modify: `src/apply/queue.ts`(`PagedQueueOpts` 加 `q?: string`;`pagedQueue`/`pagedAllJobs` 的 WHERE 追加 `AND (j.company LIKE ? OR j.title LIKE ?)`,参数 `%q%` 两次,COUNT 与 SELECT 同步)
- Modify: `src/app/api/queue/route.ts`(`q = url.searchParams.get("q")?.trim() || undefined` 透传)
- Test: `tests/apply-queue-search.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { pagedQueue, pagedAllJobs } from "@/apply/queue";
function seed(db: DB, company: string, title: string) {
  const id = db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)").run(`fp-${Math.random()}`, company, title, "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", 80, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(id, "matched");
}
describe("queue search", () => {
  it("filters by company or title, case-insensitively, in both paged views", () => {
    const db = openDb(":memory:");
    seed(db, "Stripe", "SWE New Grad"); seed(db, "Datadog", "Software Engineer Intern"); seed(db, "Acme", "Stripe integration engineer");
    expect(pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "score", q: "stripe" }).total).toBe(2);
    expect(pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "score", q: "intern" }).rows.map((r) => r.company)).toEqual(["Datadog"]);
    expect(pagedAllJobs(db, { page: 1, pageSize: 25, sort: "fresh", q: "acme" }).total).toBe(1);
    expect(pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 25, sort: "score" }).total).toBe(3);
  });
});
```

- [ ] **Step 2–5**:确认失败 → 实现 → `npx vitest run tests/apply-queue*.test.ts` → Commit `feat(api): company/title search for the paged queue`

---

### Task P0.4: 设计系统 CSS + UI 组件库 + `lucide-react`

**Files:**
- Create: `src/app/styles/{tokens,base,shell,components,pages}.css`;`src/app/components/ui/{button,chip,card,stat,field,tabs,segmented,menu,dialog,drawer,toast,skeleton,empty-state,tooltip,relative-time,page-header,index}.tsx`
- Modify: `src/app/globals.css`(只剩五行 `@import`)、`package.json`(`npm install lucide-react`)

**Interfaces (Produces):**

```tsx
// button.tsx
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: ButtonVariant; size?: "sm" | "md"; loading?: boolean; icon?: React.ReactNode; }
export function Button(props: ButtonProps): JSX.Element;                      // class: btn btn-{variant} btn-{size} [is-loading]
export function IconButton(props: ButtonProps & { label: string }): JSX.Element; // aria-label=label, class btn-icon
export function LinkButton(props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?; size?; icon? }): JSX.Element;
// chip.tsx
export type Tone = "neutral" | "accent" | "good" | "warn" | "danger" | "info";
export function Chip({ tone = "neutral", outline, size = "sm", icon, title, children }): JSX.Element; // class chip chip-{tone} [chip-outline]
// card.tsx
export function Card({ tone, padded = true, className, children, as = "div" }): JSX.Element;   // class card [card-warn|card-accent|card-good]
export function Section({ title, count, description, actions, children, className }): JSX.Element; // 顶墨线面板 section > .section-head(.section-title .section-count .section-desc .section-actions) + body
// stat.tsx
export function Stat({ label, value, sub, tone, hint, href }): JSX.Element;   // .stat .stat-label .stat-value .stat-sub
export function StatStrip({ children }): JSX.Element;                         // .stat-strip (grid, auto-fit ≥ 140px)
// field.tsx
export function Field({ label, hint, error, htmlFor, children, inline }): JSX.Element;
export const Input: forwardRef<HTMLInputElement, InputHTMLAttributes>;
export const Select: forwardRef<HTMLSelectElement, SelectHTMLAttributes>;
export const Textarea: forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes & { autoGrow?: boolean }>;
export function Stepper({ value, min = 0, max, onChange, disabled, ariaLabel }): JSX.Element; // − [n] + ,class .stepper
export function Checkbox({ label, ...input }): JSX.Element;
export function RadioCard({ name, value, checked, onChange, title, description, children }): JSX.Element; // 设置页大卡片单选
// tabs.tsx
export interface TabItem { key: string; label: React.ReactNode; count?: number }
export function Tabs({ items, value, onChange, ariaLabel }): JSX.Element;    // role=tablist, 横向滚动 .tabs
// segmented.tsx
export function Segmented<T extends string>({ options: { value: T; label: string; count?: number }[], value, onChange, ariaLabel, size }): JSX.Element; // role=radiogroup .seg
// menu.tsx
export interface MenuItem { label: React.ReactNode; onSelect: () => void; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; }
export function Menu({ items, label = "更多", icon, align = "end", size = "sm", trigger }): JSX.Element; // 点击/Esc/外点关闭;↑↓ 导航;role=menu
// dialog.tsx
export function Dialog({ open, onClose, title, description, children, actions, size = "md" }): JSX.Element; // <dialog> showModal;Esc/backdrop 关闭
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "确认", danger, busy }): JSX.Element;
export function PromptDialog({ open, onClose, onSubmit, title, label, placeholder, submitLabel = "提交", optional, multiline }): JSX.Element;
// drawer.tsx
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 560 }): JSX.Element; // aside.drawer + .drawer-backdrop;锁焦点;body 加 .no-scroll
// toast.tsx
export interface ToastOptions { title: string; description?: string; tone?: Tone; action?: { label: string; onClick: () => void }; duration?: number }
export function ToastProvider({ children }): JSX.Element; export function useToast(): { toast: (o: ToastOptions) => void };
// skeleton.tsx
export function Skeleton({ width, height, className }): JSX.Element; export function SkeletonRows({ rows = 5 }): JSX.Element; export function SkeletonCard(): JSX.Element;
// empty-state.tsx
export function EmptyState({ icon, title, description, action }): JSX.Element;
// tooltip.tsx
export function Tooltip({ content, children }): JSX.Element;   // span.tip[data-tip] + 可聚焦;CSS ::after 显示
// relative-time.tsx
export function RelativeTime({ value, mode = "ago" as "ago" | "days" }): JSX.Element;  // <time title=绝对>
// page-header.tsx
export function PageHeader({ title, subtitle, actions, children }): JSX.Element;  // h1 + .page-sub + .page-actions;children 放数字条
```

CSS 类契约(components.css 至少实现):`.btn .btn-primary .btn-secondary .btn-ghost .btn-danger .btn-sm .btn-md .btn-icon .is-loading`、`.chip .chip-{tone} .chip-outline .chip-md`、`.card .card-warn .card-accent .card-good`、`.section .section-head .section-title .section-count .section-desc .section-actions`、`.stat .stat-strip .stat-label .stat-value .stat-sub`、`.field .field-label .field-hint .field-error .input .select .textarea .stepper .checkbox .radio-card`、`.tabs .tab .tab-count`、`.seg .seg-item`、`.menu .menu-list .menu-item`、`.dialog .dialog-head .dialog-body .dialog-actions`、`.drawer .drawer-backdrop .drawer-head .drawer-body .drawer-foot`、`.toast-stack .toast .toast-{tone}`、`.skeleton`、`.empty`、`.tip`、`.table .table-scroll`、工具类 `.row .col .gap-1..4 .muted .mono .serif .truncate .sr-only .text-{tone}`。

- [ ] **Step 1:** `npm install lucide-react`(pin 到安装的版本)。
- [ ] **Step 2:** 写 tokens.css(spec §4.1 的全部变量,浅色 `:root`、深色 `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` 与 `:root[data-theme="dark"]`)、base.css(把现在 globals.css 的元素默认搬进来并按 tokens 改写;`html { font-size: 14px }`;`body { background: var(--bg) }`)。
- [ ] **Step 3:** 写 components.css 与各组件。Dialog 用原生 `<dialog>`:`useEffect` 在 `open` 变化时 `showModal()/close()`,监听 `cancel` 与 backdrop click(`e.target === dialogRef.current`)。Drawer 手动锁焦点(打开时聚焦第一个可聚焦元素,Tab 循环,Esc 关闭)。Toast 用 context + `setTimeout`,`aria-live="polite"`。Menu:按钮 `aria-haspopup="menu"`,列表 `role="menu"`,`useEffect` 监听 `mousedown`/`keydown`。
- [ ] **Step 4:** `globals.css` 改为五个 `@import`;临时保留旧类名(`.panel .panel-title .panel-sub .tabbar .tab .queue-toolbar .pagination .row-actions .jd-drawer .undo-strip .bar-*`)在 `pages.css` 末尾的「legacy(P7 删除)」段落,让未迁移页面在过渡期仍可用。
- [ ] **Step 5:** `npx tsc --noEmit`、`npm run build` 通过;在 3001 开发服务器上打开 /queue 确认旧页仍可用。
- [ ] **Step 6: Commit** `ui: design tokens, base styles and the shared component library`

---

### Task P0.5: App 壳(侧栏 / 顶栏 / 主题 / 全局状态)+ 路由级 loading/error/not-found + 图标

**Files:**
- Create: `src/app/components/shell/nav.ts`、`shell/app-shell.tsx`、`shell/theme-script.tsx`、`components/providers.tsx`、`components/overview-context.tsx`、`components/assistant-card.tsx`、`components/scan-menu.tsx`、`src/app/icon.svg`、`src/app/error.tsx`、`src/app/not-found.tsx`、`src/app/loading.tsx`
- Modify: `src/app/layout.tsx`
- Delete: `src/app/nav-links.tsx`

**Interfaces (Produces):**

```ts
// nav.ts
export interface NavItem { href: string; label: string; icon: LucideIcon; badge?: "attention" | "network" }
export const NAV: NavItem[]; // 今日 / 职位 / 投递(attention) / 历史 / 人脉(network) / 档案 / 统计;设置单独放底部
// overview-context.tsx
export function OverviewProvider({ children }): JSX.Element;   // 每 5s GET /api/overview;页面可见性变化时立刻刷新
export function useOverview(): { data: Overview | null; refresh: () => Promise<void>; error: string | null };
// assistant-card.tsx
export function AssistantCard({ variant = "full", filterKinds }: { variant?: "full" | "compact"; filterKinds?: string[] }): JSX.Element;
//   状态 = data.assistant;显示:状态标签(RUN_STATUS_LABEL)、类型(RUN_KIND_LABEL)、描述(describeRun)、开始时间(relativeTime)、最近一步(logTail 末行经 parseLogLine)、[查看步骤](RunStepsDialog)、[停止](POST /api/executor/stop,ConfirmDialog);空闲:「助手空闲」+ 上次任务摘要
export function RunStepsDialog({ runId, open, onClose, live }): JSX.Element;  // GET /api/executor/log?id=,live 时 3s 轮询;parseLog → 步骤列表(.timeline)
export function AssistantPill(): JSX.Element;   // 侧栏底部:圆点 + 「助手 · 进行中」,链接 /apply
// scan-menu.tsx
export function ScanMenu({ onDone }: { onDone?: () => void }): JSX.Element;  // Menu:立即扫描(POST /api/scan → toast 结果)/ 在我的 Chrome 里扫描(POST /api/executor/start {kind:'scan',channel:'user_chrome'} → toast);已有 scan run 排队/运行时第二项禁用并显示状态
```

`layout.tsx`:`<html lang="zh" suppressHydrationWarning>`;`<head>` 里 `<ThemeScript/>`;`metadata = { title: { default: "Sortie", template: "%s · Sortie" }, description: "你的求职助手" }`;`<body><Providers><AppShell>{children}</AppShell></Providers></body>`。`AppShell`:`<aside class="sidebar">`(brand、`NAV` 链接含图标与角标、底部 `AssistantPill`、主题按钮、设置链接)+ `<header class="topbar">`(仅手机:brand、状态点、汉堡)+ `<div class="content"><main>{children}</main></div>`;手机导航为 `.mobile-nav` 抽屉(复用 Drawer 的锁焦点逻辑或独立实现)。角标:`attention` = `attentionTotal(counts)`,`network` = `networkDrafts + networkPendingSend`。每个页面目录后续加 `export const metadata = { title: "职位" }` 等。

- [ ] **Step 1:** 实现以上文件;`error.tsx`(client:「出了点问题」+ 重试按钮 `reset()`)、`not-found.tsx`(「页面不存在」+ 回首页)、`loading.tsx`(SkeletonRows)。`icon.svg`:纸底 + 印刷红衬线「S」。
- [ ] **Step 2:** `npm run build`;3001 上检查:侧栏出现、角标数字与 /api/overview 一致、主题脚本无闪烁、375px 顶栏 + 抽屉导航可用。
- [ ] **Step 3: Commit** `ui: app shell with sidebar, mobile nav, theme and live badges`

---

# 阶段 P1:今日(首页)+ 共享决策卡

### Task P1.1: 决策卡组件从 /apply 抽出并换新组件

**Files:**
- Create: `src/app/apply/confirm-cards.tsx`(替代 confirm-panel.tsx)、`src/app/apply/info-cards.tsx`(替代 info-panel.tsx)
- Delete: `src/app/apply/confirm-panel.tsx`、`src/app/apply/info-panel.tsx`(在 P3 /apply 切换后删除;本任务先并存)

**Interfaces (Produces):**

```tsx
export function ConfirmCards({ compact }: { compact?: boolean }): JSX.Element | null;
//  轮询 GET /api/apply/pending 每 3s;用 useOverview().data.assistant 判断助手在线;无行时:compact → null,否则 EmptyState
//  每卡:.confirm-card:头(公司 serif、标题、Chip 方向、Chip 梯队、分数 mono、带内推 Chip good、简历版本 muted)
//  字段表 .kv-table(字段 / 值,值 > 120 字折叠「展开」);动作:Button primary「确认提交」、Button ghost「拒绝…」→ PromptDialog(原因可选)→ POST /api/apply/decide
//  已批准:Chip good「已批准 · 等助手提交」;助手离线:Card tone=warn 提示 + LinkButton 去 /apply#plan
export function InfoCards({ compact }: { compact?: boolean }): JSX.Element | null;
//  轮询 GET /api/apply/pending 的 needsInfo;每题 Field(label=q.label,hint=q.hint,右侧 Tooltip 显示 key);Select/Input;Checkbox「仅本次」;Button primary「提交答案,继续投递」→ POST /api/apply/answer-info → toast
```

- [ ] **Step 1:** 实现两组件(逻辑照搬旧组件,UI 全换)。**Step 2:** `npx tsc --noEmit`。**Step 3: Commit** `ui: confirmation and missing-info cards on the new component library`

### Task P1.2: 今日页

**Files:**
- Modify: `src/app/page.tsx`(不再 redirect;server:取 `overview(db)` 首屏 + `applicationHistory` 不需要)
- Create: `src/app/today/today-client.tsx`

**Interfaces:**

```tsx
export function TodayClient({ initial }: { initial: Overview }): JSX.Element;
// 结构:
// <PageHeader title={formatDateZh(new Date())} subtitle={attention === 0 ? "今天没有需要你决定的事" : `有 ${attention} 件事等你决定`} actions={<><LinkButton href="/apply#plan" variant="primary" icon={<Play/>}>开始投递</LinkButton><ScanMenu/></>}/>
// <AssistantCard/>
// <Section title="需要你处理">
//    <InfoCards/> <ConfirmCards/> <ReferralBoard onlyAttention/>(P3 提供;P1 先用 Link 卡「N 条内推留言待批 → 投递」)
//    networkDrafts > 0 → Card:「N 条 coffee chat 草稿待批」→ /network
//    全空 → EmptyState(icon Inbox,「收件箱是空的」,「去职位页看看队列前排,或开始一次投递」)
// </Section>
// <StatStrip> 队列可投 / 今日已提交 / 本周已提交 / 内推进行中 </StatStrip>(值来自 useOverview 实时,首屏用 initial)
```

- [ ] **Step 1:** 实现;`export const metadata = { title: "今日" }`。**Step 2:** 3001 检查桌面/手机/深色。**Step 3: Commit** `feat(ui): 今日 home page as the decision inbox`

---

# 阶段 P2:职位

### Task P2.1: 行组件 + 详情抽屉

**Files:**
- Create: `src/app/queue/job-row.tsx`、`src/app/queue/job-drawer.tsx`

**Interfaces:**

```tsx
// 与 src/apply/queue.ts 的 PagedQueueRow / PagedAllJobsRow 同形(客户端复制类型,不 import db 模块)
export interface JobRowData { id; company; title; location; apply_url; direction; score; tier; posted_at; pinned; dup_count?; jd_status?; referral_fit?; apply_mode?; effective_mode?; referral_reason?; created_at?; in_queue?; source? }
export interface JobRowProps {
  row: JobRowData; allTab: boolean; active: boolean; busy: boolean;
  onOpen: (id: number) => void; onPin: (row, pinned: boolean) => void; onMode: (row, mode: "referral"|"direct"|null) => void; onSkip: (row) => void;
}
export function JobRow(props: JobRowProps): JSX.Element;
// <div class="job-row [is-active] [is-pinned]" role="button" tabIndex=0 onClick=onOpen onKeyDown Enter/Space>
//   .job-score(mono,≥85 .is-top)  .job-main(.job-company serif + .job-title;.job-meta:地点截断(前 3 个 +N,title 全量)· RelativeTime days · Chip 新 / 另有 N 地点 / JD_STATUS)
//   .job-side(Chip 模式:内推 good / 海投 neutral / 未判定 outline;apply_mode 时前缀「手动·」;pinned Star 图标)
//   Menu(stopPropagation):打开申请页 / 置顶|取消置顶 / 改为找内推|改为海投 / 跟随建议(仅 apply_mode)/ 跳过(danger);allTab 且 !in_queue 时只有 打开申请页
export function JobDrawer({ jobId, rows, onNavigate, onClose, onPin, onMode, onSkip }: {...}): JSX.Element;
// Drawer:title=company,subtitle=title;body:元信息行(地点、发布、来源 LinkButton「打开申请页」);
//   Section 匹配:Stat 分数 + Chip 方向 + Chip 梯队 + 简历版本;理由段落
//   Section 资格(仅有值):Chip SPONSORSHIP/DEGREE/ROLE_KIND;其他地点;归档原因
//   Section 内推建议:文字 + 理由 + Button「改为找内推/改为海投」「跟随建议」
//   Section 职位描述:<div class="jd-text">(white-space: pre-line;>1200 字折叠「展开全文」)
//   footer:「上一条」「下一条」(按 rows 顺序)+ 置顶 + 跳过(danger)
//   数据:GET /api/jobs/{id},缓存 Map;loading 用 Skeleton
```

- [ ] **Step 1:** 实现 + pages.css 的 `.job-row*`、`.jd-text`、`.kv`。**Step 2:** tsc。**Step 3: Commit** `ui(queue): job row and detail drawer`

### Task P2.2: 队列页组装

**Files:**
- Create: `src/app/queue/queue-client.tsx`、`src/app/queue/loading.tsx`
- Modify: `src/app/queue/page.tsx`(用 PageHeader + StatStrip;`q` 从 searchParams 读;传给 client)
- Delete: `src/app/queue/queue-board.tsx`、`src/app/queue/scan-button.tsx`、`src/app/components/mode-filter.tsx`、`src/app/components/chrome-scan-button.tsx`

**Interfaces:**

```tsx
export function QueueClient({ tabs, allJobsCount, initialDirection, initialPage, initialSort, initialMode, initialQuery, initialResult, pageSize }): JSX.Element;
// 工具栏 .queue-toolbar:Tabs(方向 + 全部入库,label 含 Chip 梯队 与 count)| Segmented 全部/内推/海投(计数)| Select 排序 | Input 搜索(300ms 防抖,Enter 立即)| 次要 Button「补判内推建议(未判 N)」仅 N>0
// URL 同步:direction/page/sort/mode/q → replaceState
// 列表:loading → SkeletonRows;空 → EmptyState(队列空:「这个方向暂无可投职位」+ ScanMenu;搜索空:「没有匹配「q」的职位」)
// 跳过:本地移除 → toast({title:`已跳过 ${company} · ${title}`, action:{label:"撤销", onClick: unarchive}}, duration 8000)
// 分页 .pagination 在底部;抽屉 JobDrawer 由 activeId 控制
```

- [ ] **Step 1:** 实现。**Step 2:** 3001 检查:tab 切换、搜索、排序、模式筛选、抽屉、跳过撤销、置顶、改模式、375px。**Step 3:** 删除旧文件,tsc/build。**Step 4: Commit** `feat(ui): 职位 queue rebuilt with toolbar, search, drawer and undo`

---

# 阶段 P3:投递 + 设置

### Task P3.1: 投递计划卡

**Files:**
- Create: `src/app/apply/plan-card.tsx`
- Delete(P3.4 时): `src/app/apply/quota-table.tsx`、`src/app/components/executor-panel.tsx`

**Interfaces:**

```tsx
export function PlanCard(): JSX.Element;
// 数据:GET /api/queue/by-direction;useOverview().data.assistant 判断 apply run 是否 queued/running(busy)
// Card id="plan":head:「本次投递计划」+ 右侧 muted「将{CHANNEL_LABEL[getChannel()]}操作 · <Link href="/settings">更改</Link>」+ Menu 更多:「补正文(Claude 逐页读)· 待补 N」→ POST /api/executor/start {kind:'jd_review', channel:'headless', options:{limit:40}}
// 表 .plan-table:方向(directionLabel + Chip 梯队)| Stepper 找内推(max referralSuggested,右侧 muted「可取 N」)| Stepper 海投 | 小计 mono
// 粘性汇总 .plan-foot:「共 N 份(找内推 a · 海投 b)」+ Button primary「开始投递」(total 0 或 busy 禁用)→ POST /api/executor/start {kind:'apply', channel:getChannel(), options:{plan: buildPlan(order, counts)}} → toast;busy 时显示「进行中 · 见上方助手卡」
```

- [ ] **Step 1:** 实现。**Step 2:** tsc。**Step 3: Commit** `ui(apply): plan card with steppers and sticky start`

### Task P3.2: 内推进行中 + 有内推了对话框

**Files:**
- Create: `src/app/apply/referral-board.tsx`、`src/app/apply/referral-contact.tsx`、`src/app/apply/referral-won-dialog.tsx`
- Delete(P3.4): `src/app/apply/referral-panel.tsx`

**Interfaces:**

```tsx
export function ReferralBoard({ onlyAttention }: { onlyAttention?: boolean }): JSX.Element | null;
// 轮询 GET /api/referral/board 每 5s;onlyAttention 时只显示有 draft 或 stage ∈ {will_refer, referred} 的卡,且无卡返回 null
// 顶部:Button ghost「现在检查回复」(POST /api/referral/check)+ Tooltip「早 9 点、晚 6 点自动检查;每次任务前也会检查」
// 卡 .referral-card:head(公司 serif + 状态摘要 Chip:有内推·待投 good / N 人 · 摘要 / 找不到人 danger / 找人中… + 「已等 N 天」overdue → danger)
//   岗位列表(标题链接 + Chip 方向 + 分)
//   联系人列表 → <ReferralContact o edits onChange onApprove onReject onUnapprove busy/>
//   卡底:ready → Button primary「开始投(重新入队)」;否则 Button「直接投」ghost「有内推了…」(→ ReferralWonDialog)「再撒网」(仅 anyOut)「放弃…」(ConfirmDialog danger)
export function ReferralContact(props): JSX.Element;
// 姓名 · RELATION_LABEL · LinkedIn 链接 · Chip OUTREACH_STATUS · 发于 localShort
// sent/accepted/replied:Chip REFERRAL_STAGE(tone)+ 上次检查 relativeTime + 阶段摘要 + 最后一条(对方)+ 建议(warn)+ 已内推提示(good,「请点「有内推了」确认」)
// draft:Textarea 完整版(字数)+ Textarea 留言版(n/200,超限 danger)+ Button primary「批准发送」(超限禁用)ghost「拒绝」
// pending_send:两版只读 .msg-quote + Button ghost「退回草稿」
export function ReferralWonDialog({ open, onClose, initial: { company, jobIds, personName, source, link, code, note }, onSaved }): JSX.Element;
// Dialog:Select 来源(LinkedIn/邮件/微信/其他)、Input 推荐人 *、推荐链接、推荐码、备注;Button primary「保存并开始投」→ POST /api/referral/decide {jobIds, action:'won', info, personName}
```

- [ ] **Step 1:** 实现(逻辑从 referral-panel.tsx 搬)。**Step 2:** tsc。**Step 3: Commit** `ui(apply): referral board cards, contact rows and the referral-won dialog`

### Task P3.3: 需人工 + 今日已提交

**Files:**
- Create: `src/app/apply/manual-list.tsx`(重写,同名)、`src/app/apply/today-submitted.tsx`
- Delete: `src/app/apply/unpark-button.tsx`

**Interfaces:**

```tsx
export interface ManualRow { job_id; company; title; apply_url; needs_manual_reason; direction; updated_at }
export function ManualList({ rows: initial }: { rows: ManualRow[] }): JSX.Element;
// 本地 state;行 .manual-row:Checkbox | 公司 serif + 标题 + Chip 方向 | 原因 muted(截断 + Tooltip)| 时间 mono | Menu:打开申请页 / 重试(POST /api/apply/unpark → 本地移除 + toast)/ 移除(ConfirmDialog → POST /api/apply/archive-manual → 本地移除 + toast 撤销 → POST /api/queue/unarchive)
// 批量:全选 + Button「移除所选 (n)」→ ConfirmDialog
export function TodaySubmitted({ rows }: { rows: TodaySubmittedRow[] }): JSX.Element;  // 紧凑列表 + 「完整记录 → 历史」
```

- [ ] **Step 1–3:** 实现 → tsc → Commit `ui(apply): manual list with dialogs and undo; today's submissions`

### Task P3.4: 投递页组装 + 设置页

**Files:**
- Modify: `src/app/apply/page.tsx`
- Create: `src/app/apply/loading.tsx`、`src/app/settings/page.tsx`、`src/app/settings/settings-client.tsx`
- Delete: `quota-table.tsx`、`confirm-panel.tsx`、`info-panel.tsx`、`referral-panel.tsx`、`unpark-button.tsx`、`components/executor-panel.tsx`(人脉页 P5 前先给 network/page.tsx 一个临时的 `NetworkAssistant` 占位——见 P5.1;为避免中间态编译失败,P3.4 先在 `src/app/network/network-assistant.tsx` 创建 P5.1 的组件)

**Interfaces:**

```tsx
// apply/page.tsx(server):metadata 投递;取 manualRows、todaySubmitted 首屏;结构:
// <PageHeader title="投递" subtitle="选好份数,助手在你的 Chrome 里填表;提交前一定先经你确认。"/>
// <AssistantCard/> <PlanCard/> <InfoCards/> <Section title="待确认" count><ConfirmCards/></Section>
// <Section title="内推进行中"><ReferralBoard/></Section> <Section title="需人工" count><ManualList/></Section> <Section title="今日已提交" count><TodaySubmitted/></Section>
// settings-client.tsx
export function SettingsClient({ ntfyConfigured, lastTick }: { ntfyConfigured: boolean; lastTick: { at: string; boards: number; inserted: number; errors: number } | null }): JSX.Element;
// Section 执行方式:两张 RadioCard(在我的 Chrome 里操作(推荐)/ 后台浏览器(无人值守));后台卡内 Button「打开浏览器档案登录一次」→ POST /api/executor/open-profile → toast;保存到 setChannel
// Section 外观:Segmented 浅色/深色/跟随系统 → setTheme + applyTheme
// Section 通知:Chip 已配置/未配置 + 一行说明(「手机推送需在 .env 设置 NTFY_TOPIC 并在 ntfy 应用订阅同名频道」)
// Section 信息源:上次检查 relativeTime + 「问了 N 个板块,新增 N 个岗位,N 个出错」+ Button「立即扫描」+ LinkButton「信息源高级页」→ /sources
```

- [ ] **Step 1:** 实现;`settings/page.tsx`(server)读 `process.env.NTFY_TOPIC` 与 `/api/sources` 用的 `sourcesSummary(db).lastTick`(直接 import `@/scanner/sources-view`)。**Step 2:** build + 3001 检查全流程(计划 → 开始投递 → 排队状态显示;设置切换主题与通道)。**Step 3:** 删除旧文件。**Step 4: Commit** `feat(ui): 投递 page rebuilt; settings page with channel, theme, notifications and sources`

---

# 阶段 P4:历史 + 统计

### Task P4.1: 历史

**Files:**
- Create: `src/app/history/history-client.tsx`、`src/app/history/stage-menu.tsx`、`src/app/history/loading.tsx`
- Modify: `src/app/history/page.tsx`、`src/app/history/history-sankey.tsx`(用 Section;颜色不变)
- Delete: `src/app/history/history-board.tsx`

**Interfaces:**

```tsx
export function StageMenu({ value, busy, onChange }: { value: PostSubmitStage; busy: boolean; onChange: (stage: PostSubmitStage) => void }): JSX.Element;
// Menu trigger = Chip(tone 按阶段:offer* warn / oa,interview good / rejected,stale neutral / submitted info)+ ChevronDown
export function HistoryClient({ rows }: { rows: HistoryRow[] }): JSX.Element;
// StatStrip 各阶段计数(仅 >0);HistorySankey;Tabs 方向 + Segmented 模式;按日 Section;行 .history-row(桌面 grid:时间 | 方向 | 方式 | 公司+标题 | 简历 | 状态 StageMenu | 更新 | 备注;手机 卡片)
// 改状态:StageMenu 选择 → PromptDialog(备注可选)→ POST /api/apply/stage → 本地更新 row.status/updatedAt/lastNote + toast;不 reload
```

- [ ] **Step 1–3:** 实现 → build → Commit `feat(ui): 历史 with stage menu and note dialog`

### Task P4.2: 统计

**Files:**
- Modify: `src/app/dashboard/page.tsx`;Create `src/app/dashboard/loading.tsx`
- 结构:PageHeader 统计;StatStrip(已投递 / 面试 / Offer / 本周已投递 vs 上周 sub);Section 申请漏斗(.bar-row 保留,tokens 配色);Section 分方向(table-scroll);Section 人脉漏斗;Section 内推 vs 海投;删除「待办」小节。

- [ ] **Step 1–3:** 实现 → build → Commit `ui: 统计 page on the new components`

---

# 阶段 P5:人脉

### Task P5.1: 人脉页拆分重建

**Files:**
- Create: `src/app/network/network-assistant.tsx`、`drafts-cards.tsx`、`contacts-pane.tsx`、`contact-detail.tsx`、`person-dialog.tsx`、`draft-dialog.tsx`、`loading.tsx`
- Modify: `src/app/network/page.tsx`、`src/app/network/network-client.tsx`(缩成编排层 ≤ 200 行)

**Interfaces:**

```tsx
export function NetworkAssistant(): JSX.Element;
// Card:AssistantCard compact filterKinds=['network_send','network_find'] + Button「发送已批准消息」(POST start {kind:'network_send', channel:getChannel()})+ Button ghost「找人(队列头部公司)」
export function DraftsCards({ drafts, sendables, onApprove, onReject, onMarkSent, busyId, edited, setEdited }): JSX.Element;
// 两个 Section:草稿待批(Textarea 可编辑 + 批准发送/拒绝)、已批准待发(LinkedIn:Chip「等助手发送」;邮件:Button「打开邮件」mailto + ghost「标记已发」)
export function ContactsPane({ people, selectedId, onSelect, onAdd, query, setQuery, relation, setRelation }): JSX.Element;
// Input 搜索 + Select 关系 + Button「添加联系人」;列表 .contact-list(姓名 serif、公司 · 职位 muted、Chip 关系)
export function ContactDetail({ person, outreach, jobMap, onDraft, onOutcome, busyId }): JSX.Element;
// 头(姓名、公司·职位、LinkedIn/Email 链接、Button「AI 草稿…」);关联岗位;时间线 .timeline(每条 outreach:剧本 · 渠道 · 状态 Chip · 时间;消息气泡 .bubble-sent/.bubble-received;结果按钮 约到了/拿到内推/无回应)
export function PersonDialog({ open, onClose, onSaved }): JSX.Element;    // 表单 → POST /api/network/people
export function DraftDialog({ open, onClose, people, defaultPersonId, onCreated }): JSX.Element; // 选联系人/剧本/渠道 → POST /api/network/draft(约 30s,按钮 loading)
```

手机:`ContactsPane` 全宽,选中后 `ContactDetail` 在 Drawer 里。

- [ ] **Step 1–3:** 实现 → build → Commit `feat(ui): 人脉 rebuilt as contacts + detail with draft dialogs`

---

# 阶段 P6:档案

### Task P6.1: 档案页(三标签)

**Files:**
- Create: `src/app/profile/profile-tabs.tsx`、`experiences-tab.tsx`、`experience-dialog.tsx`、`resumes-tab.tsx`、`answers-tab.tsx`、`loading.tsx`
- Modify: `src/app/profile/page.tsx`(server:experiences、standardAnswers、resumes(含 direction 列)首屏;`?tab=`)、`src/app/studio/page.tsx` → `redirect("/profile?tab=resumes")`
- Delete: `profile/experience-editor.tsx`、`profile/standard-answers-editor.tsx`、`studio/generate-panel.tsx`

**Interfaces:**

```tsx
export function ProfileTabs({ tab, experiences, answers, resumes }): JSX.Element; // Tabs 经历/简历/标准答案;URL ?tab= 同步(replaceState)
export function ExperiencesTab({ initial }): JSX.Element;
// 按 kind 分组 Section(EXPERIENCE_KIND_LABEL);卡 .exp-card:标题 serif · 机构 · 地点 · 起止 mono;bullets 列表(每条后 Chip 方向标签);Menu:编辑(ExperienceDialog)/ 删除(ConfirmDialog → DELETE /api/experiences/:id)
// 头部 Button primary「添加经历」;空态引导
export function ExperienceDialog({ open, onClose, initial, onSaved }): JSX.Element;
// Select 类型 | Input 标题 * | 机构 | 地点 | 开始(YYYY-MM)| 结束(YYYY-MM 或 Present)| bullets 列表(Textarea autoGrow + 方向多选 Chip 切换 + 删除 + 「添加要点」)| 保存 → POST /api/experiences 或 PUT /api/experiences/:id
export function ResumesTab({ resumes, hasExperiences }): JSX.Element;
// 网格 .resume-grid:卡(版本名 serif、Chip 方向(directionLabel)、生成时间 localShort、Button「预览」→ Drawer 内 <iframe src=/api/resumes/:id/pdf>、LinkButton「打开 PDF」);Button primary「生成新版本」→ Dialog(Select 方向 directionLabel、Input 版本名可选)→ POST /api/resumes/generate(loading 20–40s)→ router.refresh + toast
export function AnswersTab({ initial }): JSX.Element;
// 行 .answer-row:Field label=answerLabel(key) hint=key(mono muted)+ Input 值 + IconButton 删除;自定义 key 行(Input key + Input 值);建议胶囊(ANSWER_LABELS 未用的);Button primary「保存」→ PUT /api/profile/standard-answers → toast
```

- [ ] **Step 1–3:** 实现 → build → 3001 检查三标签、编辑经历、预览 PDF → Commit `feat(ui): 档案 page with editable experiences, resume previews and friendly standard answers`

---

# 阶段 P7:文案审计、来源页、可达性/响应式/深色三遍、文档

### Task P7.1: 来源页重排

- Modify `src/app/sources/page.tsx`、`sources-board.tsx`:PageHeader(「信息源」+ subtitle「后台自动按层级轮询;这里用于排查」)、StatStrip、Section 按家族(table-scroll)、Section 板块(工具栏 Input/Select + 分页;行内 Select 层级 + Menu 问一次/静音|恢复)、Section 最近升降级;动作结果用 toast;ScanMenu 复用。
- [ ] Commit `ui: sources page on the new components`

### Task P7.2: 文案审计与 legacy CSS 清理

- [ ] `grep -rn "值守会话\|执行器\|run #\|pid\|user_chrome\|headless\|profile.yaml\|sqlite\|claude-in-chrome\|答案包" src/app --include=*.tsx` → 除 settings 的一处说明外必须为 0(设置页可写「在我的 Chrome 里操作需要 Claude 桌面应用的 Chrome 扩展已连接」)。
- [ ] 删除 `pages.css` 的 legacy 段落;`grep -rn "panel-title\|tabbar\|btn-ghost\|undo-strip" src/app` 为 0。
- [ ] 每个页面目录有 `loading.tsx` 与 `metadata.title`。
- [ ] Commit `ui: copy audit and legacy style removal`

### Task P7.3: 三遍检查

- [ ] **响应式**:3001 上 375 / 768 / 1280 逐页截图(今日、职位、投递、历史、人脉、档案 ×3、统计、设置、信息源);无横向滚动(`document.documentElement.scrollWidth <= innerWidth`)。
- [ ] **深色**:`resize_window colorScheme dark` 逐页;无硬编码颜色(`grep -rn "#[0-9a-fA-F]\{3,6\}" src/app --include=*.tsx` 为 0;CSS 中只在 tokens.css 出现)。
- [ ] **可达性**:每个 IconButton 有 aria-label;Dialog/Drawer Esc 关闭且焦点回到触发器;Tab 键可到达确认/批准按钮;对比度抽查(sub 文本 ≥ 4.5:1)。
- [ ] Commit `ui: responsive, dark-mode and accessibility pass`

### Task P7.4: 文档

- [ ] CLAUDE.md:§0/§2/§3/§4 中界面位置改为新位置(「/apply 待补信息」→ 「投递页 / 首页的待补信息卡」;「/queue 立即扫描旁 Chrome 扫描」→ 「职位页 / 首页 扫描菜单」;「/apply 配额表」→ 「投递页 本次投递计划」;「Profile / Studio」→ 「档案 页三个标签」;通道选择 → 设置页);加一段「前端结构(2026-09-06 重做)」指向 spec 与 `src/app/components/ui`。
- [ ] README:导航说明更新。
- [ ] `.claude/skills/*/SKILL.md` 中若提到页面名(grep「/apply」「/queue」「Profile」)按同样映射改。
- [ ] Commit `docs: point CLAUDE.md, README and skills at the rebuilt UI`

---

# 阶段 P8:验证与合入

- [ ] `npm test` 全绿;`npm run build` 无警告;`npx tsc --noEmit`。
- [ ] 3001 端到端:一次「开始投递」入队 → 助手卡显示排队 → 停止;跳过/撤销;历史改状态;设置切主题;档案编辑一条经历再改回。
- [ ] 主检出 `git status` 干净后:`git checkout main && git merge --no-ff claude/app-frontend-market-ready-cb20ca`;`npm run build && launchctl kickstart -k gui/$(id -u)/com.jobseeker.os`;`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/` = 200;逐页 200。
- [ ] 记忆文件更新(前端重做已落地;新页面结构)。
