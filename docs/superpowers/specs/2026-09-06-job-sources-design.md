# 岗位信息源优化设计(2026-09-06)

用户目标(2026-09-05 对齐):覆盖面、精度、新鲜度、方向补缺四个都要;登录类来源(LinkedIn 登录态 / Handshake / Tesla)也纳入;自动发现的公司**全自动 + 按产出分级**,不做人工审批;扫描**不通知**,结果直接进 /queue;队列每行显示发布时间,默认排序改为"分数减时间惩罚"的综合分;打分逻辑本身不改。

## 0. 审视结论(数据截至 2026-09-05,库内 11,318 岗)

| 来源 | 岗位 | 无 JD | 近 7 天新增(美国) | 队列 ≥75 分 |
|---|---|---|---|---|
| GitHub 清单(Simplify 新人岗 + 2027 实习) | 8033 | 6101(76%) | 1414 | 1114 |
| Greenhouse 直连(20 家) | 2255 | 0 | 98 | 136 |
| Ashby 直连(6 家) | 760 | 0 | 39 | 140 |
| Lever 直连(2 家) | 270 | 0 | 4 | 36 |

关键事实:
1. 同样 28 家公司,直连抓到 2173 个美国岗,只有 86 个(4%)出现在清单里;≥75 分的 305 个里清单只覆盖 30 个。清单只收标题写明 New Grad/Intern 的岗。
2. 清单岗 76% 没有 JD,打分靠标题猜;高分队列里 Workday 岗 195 个、Tesla 48 个全部无 JD。
3. 缺失的 ATS 家族(按压在队列里的 ≥75 分岗):TikTok/字节 283、Workday 195(379 个租户)、iCIMS 56、Tesla 48、Oracle HCM 29、Workable 22、SmartRecruiters 11。
4. 板块可自动发现:库内 URL 能解析出 Greenhouse 166+59、Ashby 233、Lever 55、Workday 379、SmartRecruiters 92、Oracle 59、iCIMS 67 个板块;开源目录(zshah101 `data/companies.json`)另有 4725 家(Workday 1781、Greenhouse 1054、Ashby 713、Lever 396、SmartRecruiters 292、Workable 161、Oracle 158、Rippling 153),抽样存活率 Greenhouse 11/12、Lever 11/12、Ashby 8/12、Workday 29/30。
5. 方向失衡:队列 swe_general 1293,gpu_cuda 20(≥75 的 6),security 80(≥75 的 1),robotics 117。
6. 候选清单净增量(按 URL 和公司+标题去重):vanshb03 New-Grad-2027 +593(无发布日期字段)、vanshb03 Summer2027 +219、zapplyjobs New-Grad-Jobs-2027 +547、zapplyjobs Internships-2027 +435;jobright 清单噪声大,不用。
7. 接口实测可用:Workday CXS(列表 + 详情 JD)、SmartRecruiters 公开 API、Oracle HCM REST、Workable、Amazon search.json、字节/TikTok 搜索接口(同一接口切 `website-path`)、LinkedIn 游客接口(含 JD,无外部 apply 链接)。不可用:Tesla(Akamai 403)、Eightfold(403)、Apple/Microsoft/Google 搜索接口。iCIMS 只有 HTML 但可解析。Jane Street 与 Waymo 有 Greenhouse 板块。
8. 体量预估:全量目录首轮候选岗约 3.2 万(入门级标题 + 工程标题 + 美国),匹配器 6 并发约 5 小时;之后每天增量几百。20 个 Greenhouse 板块并发拉全文 0.2 秒。

## 1. 数据模型(schema v12)

### 1.1 `boards`——凡是被轮询的东西都是一行

```sql
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,            -- family:ident
  family TEXT NOT NULL,                -- greenhouse|lever|ashby|workday|bytedance|smartrecruiters|oracle|icims|workable|amazon|linkedin|github_list|chrome
  ident TEXT NOT NULL,
  company TEXT,                        -- 聚合源可空
  origin TEXT NOT NULL,                -- seed|url|directory|builtin|manual
  tier TEXT NOT NULL DEFAULT 'longtail', -- core|longtail|dormant|muted
  tier_reason TEXT,
  tier_locked INTEGER NOT NULL DEFAULT 0, -- 用户手动设过就不再自动升降
  directions TEXT,                     -- JSON 数组,种子给的方向提示,只做展示
  meta TEXT,                           -- JSON,适配器附加信息(workday {wd,site};list {url,kind,etag})
  next_due_at TEXT,                    -- NULL = 从没问过 → 立刻到期
  last_polled_at TEXT, last_ok_at TEXT, last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boards_due ON boards(tier, next_due_at);
```

key 例子:`greenhouse:stripe`、`lever:palantir`、`ashby:openai`、`workday:nvidia.wd5/NVIDIAExternalCareerSite`、`smartrecruiters:ServiceNow`、`oracle:egug.fa.us2.oraclecloud.com/CX_1`、`icims:careers-sig.icims.com`、`workable:tickpick`、`bytedance:tiktok`、`bytedance:bytedance`、`amazon:us`、`linkedin:guest`、`github_list:simplify-newgrad`、`chrome:linkedin`、`chrome:handshake`、`chrome:tesla`。

产出不存计数器,实时从 `jobs.board_key` 聚合。

### 1.2 `jobs.board_key`

新列 `board_key TEXT` + 索引。插入时由 `src/scanner/board-key.ts` 的 `parseBoard(apply_url)` 推出,**所有来源都算**:清单带来的岗也归到它所属的板块。同一解析器同时给出 `ats` 族名,清单岗现在为空的 `ats` 一并补上(执行器提示词按 ATS 给技巧)。迁移对存量回填两列,并为每个解析出的 key 建 boards 行(origin=url,tier=longtail),迁移末尾跑一次 retier,让已经出过高分岗的板块直接成为 core。

### 1.3 `companies` 与种子

`companies` 表保留不动、不再驱动轮询(`watchlist.ts` 留作兼容,不再被扫描调用)。`config/watchlist.seed.json` 由 `config/boards.seed.json` 取代:

```json
[{ "key": "greenhouse:stripe", "company": "Stripe", "tier": "core", "directions": ["swe_backend","swe_general"] },
 { "key": "workday:nvidia.wd5/NVIDIAExternalCareerSite", "company": "NVIDIA", "tier": "core", "directions": ["gpu_cuda","ai_infra"] }]
```

启动(每次 `/api/scan/tick` 首次运行)时 `syncBoardsSeed` 把种子写入 boards(origin=seed;已存在且 tier_locked 的不改 tier)。内置聚合源(6 份清单、bytedance 两个门户、amazon:us、linkedin:guest、chrome:* 三行)也在种子里,origin=builtin。

原 watchlist 里 7 家从未轮询的公司:NVIDIA → Workday 租户;Jane Street → `greenhouse:janestreet`;Waymo → `greenhouse:waymo`;Tesla → `chrome:tesla`;Citadel / Two Sigma / Apple 无可轮询接口,靠清单 + LinkedIn + Chrome 通道兜底(不入种子)。

### 1.4 分级语义

| tier | 周期 | 进入条件 |
|---|---|---|
| core | 1 小时(Workday、iCIMS ×3,LinkedIn ×2) | origin=seed;或近 90 天该板块出过 ≥1 个 ≥75 分岗;或 ≥3 个 ≥60 分岗 |
| longtail | 24 小时 | url 发现、目录导入的默认层;core 连续 90 天无 ≥75 也回到这里 |
| dormant | 7 天 | longtail 连续 30 天有轮询记录且零 ≥60 分岗 |
| muted | 不轮询 | 用户手动;或连续 5 次 404 自动静音(tier_reason 记 `404 x5`,可一键恢复) |

`retier(board, stats, now)` 是纯函数(`src/scanner/retier.ts`),每天本地 03:00 全量跑一次;匹配器每写入一个 ≥75 分,立即把该板块升 core(不等第二天)。`tier_locked=1` 的板块永不自动变。每次升降写 `events(kind='board_retier')`。

### 1.5 `jobs.source` 新值

`workday | bytedance | smartrecruiters | oracle | icims | workable | amazon | linkedin | handshake | tesla`。`RawJob.source` 类型随之放宽。`consolidate.pickCanonical` 里对 `github_list` 降权的规则扩到 `linkedin`(LinkedIn 行没有外部申请链接,应让位给直连行)。

## 2. 适配器矩阵

统一接口(`src/scanner/sources/index.ts`):

```ts
interface FetchCtx { fetcher: Fetcher; depth: "core" | "longtail"; isKnownUrl: (url: string) => boolean; }
type BoardFetcher = (board: BoardRow, ctx: FetchCtx) => Promise<RawJob[]>;
const REGISTRY: Record<Family, { fetch: BoardFetcher; concurrency: number; minGapMs: number }>;
```

`depth` 决定翻页上限(core 深、longtail 浅);`isKnownUrl` 让需要"列表 + 详情"两步的适配器只为新岗拉详情。每种来源一个文件,失败只影响自己,错误记到该板块 `last_error`。

| family | 列表 | 详情 / JD | 发布时间 | applyUrl | 备注 |
|---|---|---|---|---|---|
| greenhouse / lever / ashby | 现有函数不变,加薄包装 | 列表自带 | 自带 | 自带 | 扩到几百上千家 |
| workday | `POST https://<tenant>.<wd>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` `{appliedFacets:{},limit:20,offset,searchText}`,关键词 `new grad / new college grad / graduate / intern / early career / university / entry level / campus`,按 externalPath 去重;core 每词 ≤25 页,longtail ≤5 页 | `GET …/wday/cxs/<tenant>/<site><externalPath>` → `jobPostingInfo.jobDescription`(HTML→文本)、`location`、`additionalLocations` | `jobPostingInfo.startDate` | `jobPostingInfo.externalUrl`,缺省拼 `https://<tenant>.<wd>.myworkdayjobs.com/<site><externalPath>` | 列表阶段先用 `locationsText` 过 locFlag,非美国不拉详情也不入库(计入 locSkipped);详情失败则以空 JD 入库,交给 jd_review |
| bytedance | `POST https://jobs.bytedance.com/api/v1/search/job/posts`,头 `website-path: tiktok`(portal_type 4)/ `bytedance`(portal_type 6),关键词 `graduate / intern / new grad / campus`,limit 50,每词 ≤400 条 | 列表自带 `description` + `requirement` | `publish_time`(毫秒) | `https://lifeattiktok.com/search/<id>` / `https://jobs.bytedance.com/en/position/<id>/detail` | 城市白名单:San Jose、Seattle、Los Angeles、New York、San Francisco、Mountain View、Austin、Chicago、Bellevue、Washington、Irvine、Culver City、Miami、Boston;`recruit_type.parent.en_name=Campus` 且标题含 intern → intern |
| smartrecruiters | `GET https://api.smartrecruiters.com/v1/companies/<id>/postings?limit=100&offset=&country=us`,≤500 条 | `GET …/postings/<postingId>` → `jobAd.sections.{jobDescription,qualifications,additionalInformation}` | `releasedDate` | `https://jobs.smartrecruiters.com/<id>/<postingId>` | 目录里不少中介,靠分级沉下去 |
| oracle | `GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=<site>,limit=25,offset=<n>,keyword=<kw>,sortBy=POSTING_DATES_DESC`,kw ∈ `engineer / software / graduate / intern`,每词 ≤100 条 | `recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="<Id>",siteNumber=<site>` → `ExternalDescriptionStr` + `ExternalQualificationsStr` | `PostedDate` | `https://<host>/hcmUI/CandidateExperience/en/sites/<site>/job/<Id>` | |
| icims | `GET https://<host>/jobs/search?ss=1&searchKeyword=<kw>&in_iframe=1&pr=<page>`,kw ∈ `engineer / software / graduate / intern`,每词 ≤3 页;解析 `href="https://<host>/jobs/<id>/<slug>/job"` 与标题 | `GET …/job?in_iframe=1` → `.iCIMS_JobContent` 文本,失败退回 `jd-fetch` 的通用剥离 | 页面 Posted Date 字段,缺省 null | 职位页 URL | 并发 2、间隔 500ms;地点从列表 "Job Locations" 字段尽力解析 |
| workable | `POST https://apply.workable.com/api/v3/accounts/<acct>/jobs`,按 `nextPage` token 翻页,≤300 条 | `GET https://apply.workable.com/api/v2/accounts/<acct>/jobs/<shortcode>` → `description` + `requirements` | `published` | `https://apply.workable.com/<acct>/j/<shortcode>/` | |
| amazon | `GET https://www.amazon.jobs/en/search.json?base_query=<q>&country[]=USA&normalized_country_code[]=USA&result_limit=100&offset=<n>&sort=recent`,q ∈ `graduate / early career / new grad / university`,每词 ≤300 | 列表自带 `description` | `posted_date`("September  4, 2026") | `https://www.amazon.jobs<job_path>` | |
| linkedin(游客) | `GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<kw>&location=United%20States&f_TPR=r86400&f_E=1%2C2&sortBy=DD&start=<0,25,50>`;每方向 2–3 组关键词(profile 方向 tier 排序),解析卡片 title / company / location / `time[datetime]` / `data-entity-urn` | `GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>` → `.show-more-less-html__markup` 文本 + criteria(seniority / employment type) | 卡片 datetime | `https://www.linkedin.com/jobs/view/<id>/`(无外部链接,执行器在用户 Chrome 里点 Apply 跳转) | 顺序执行、间隔 3s(≤20 次/分钟);连续 2 次 429/999 → 本轮停、`next_due_at` 明天;只在本地 08:00–22:00 运行,周期 2 小时 |
| github_list | 6 份:Simplify 新人岗 / Simplify 2027 实习 / vanshb03 New-Grad-2027 / vanshb03 Summer2027 / zapplyjobs New-Grad-Jobs-2027 / zapplyjobs Internships-2027。JSON 的复用 `fetchGithubList`;zapplyjobs 只有 README 表格,新增 `readme-table.ts` 解析(公司列 `↳` 表示沿用上一行;链接取第一个非图片、非 simplify 中转的 URL;年龄列 `4m/2d` 折算 postedAt) | 无 | JSON `date_posted`;README 年龄列 | 清单链接 | 条件请求:`If-None-Match` 用 `meta.etag`,304 直接返回 |
| chrome | 不由调度器轮询(family=chrome 被排除);由 Chrome 扫描 run 经 `/api/scan/ingest` 入库,`last_ok_at` 由 ingest 更新 | — | — | — | 见 §4 |

**工程标题门** `isEngineeringTitle(title)`(`src/scanner/entry-level.ts`):标题须命中 `software|engineer|engineering|developer|swe|sde|machine learning|\bml\b|\bai\b|data|research|quant|firmware|embedded|robotic|autonomy|perception|security|sre|site reliability|infrastructure|systems?|platform|backend|back-end|full.?stack|frontend|front-end|gpu|cuda|compiler|kernel|devops|cloud|scientist|analyst|technolog|technical|hardware|fpga|asic|controls?|simulation|computer vision|nlp` 之一。只对 family ∈ {workday, smartrecruiters, oracle, icims, workable, linkedin, amazon} 以及 origin ∈ {url, directory} 的 greenhouse/lever/ashby 生效;origin=seed 的板块和清单不设门。现有 `isEntryLevelTitle`、`visaFlag`、`locFlag` 照旧。

**方向补缺种子**(2026-09-06 逐个验证板块可用):
- gpu_cuda / ai_infra:`workday:nvidia.wd5/NVIDIAExternalCareerSite`、`ashby:cerebras`、`ashby:etched`、`greenhouse:togetherai`、`ashby:baseten`、`greenhouse:sambanovasystems`、`greenhouse:lightmatter`
- security:`workday:crowdstrike.wd5/crowdstrikecareers`、`greenhouse:sentinellabs`、`greenhouse:wizinc`、`greenhouse:okta`、`greenhouse:abnormalsecurity`、`greenhouse:tailscale`(Datadog、Cloudflare 已在)
- robotics:`greenhouse:andurilindustries`、`greenhouse:waymo`、`ashby:applied`、`lever:zoox`、`greenhouse:nuro`、`greenhouse:motional`、`greenhouse:kodiak`、`greenhouse:figureai`、`ashby:physicalintelligence`、`ashby:1x`、`greenhouse:agilityrobotics`、`workday:bostondynamics.wd1/Boston_Dynamics`、`greenhouse:wayve`、`greenhouse:maymobility`、`greenhouse:torcrobotics`、`lever:dexterity`
- embedded:`greenhouse:spacex`、`greenhouse:neuralink`、`greenhouse:verkada`、`greenhouse:formlabs`、`greenhouse:astranis`、`lever:hermeus`、`greenhouse:relativity`、`workday:analogdevices.wd1/External`、`workday:nxp.wd3/careers`
- AMD / Qualcomm / Arm 的 Workday 站点名以目录为准(实施时从目录查)。

## 3. 调度与流水线

### 3.1 每分钟一跳的调度器

`src/instrumentation.ts` 保持零 import,每 60 秒 `POST /api/scan/tick`。`src/scanner/scheduler.ts`:

```ts
runTick(db, { now, budgetBoards = 300, budgetMs = 90_000, families?, tiers? }) → TickSummary
```

1. 首次 tick 先 `syncBoardsSeed`。
2. 选到期板块:`tier <> 'muted' AND family <> 'chrome' AND (next_due_at IS NULL OR next_due_at <= now)`,顺序 core → github_list → longtail → dormant,同层按 `next_due_at` 早者先;linkedin 只在 08:00–22:00 入选。
3. 按 family 分组并发(默认 8;workday 4;icims 2;linkedin 1),每个板块 `fetch → upsertJobs(db, rows, { boardKey })`,成功则 `fail_count=0, last_ok_at=now, last_error=NULL`,失败则 `fail_count++`、`last_error`。
4. 回拨 `next_due_at = now + cadence(tier) × (1 ± 10% 抖动)`;失败时 `× 2^min(fail_count,3)`;连续 5 次 404 → `tier='muted', tier_reason='404 x5'`。
5. 写 `events(kind='scan_tick', payload = TickSummary{boards, inserted, upgraded, duplicates, visaSkipped, locSkipped, byFamily, errors})`。
6. 若 `inserted > 0` 且 `tryAcquireMatching()` 成功 → 后台跑现有接力(§3.3)。

`runScan(db)` 保留为"核心 + 清单立刻问一遍"的包装(把这些板块 `next_due_at` 置为过去再 `runTick`,budget 放大),返回原 `ScanSummary` 形状;`/api/scan`(「立即扫描」)和 `scripts/scan.ts` 调用它。`/api/scan` 里的扫描通知删除。

### 3.2 `upsertJobs`

从 `run.ts` 抽出 `upsertJobs(db, rows, opts)`:同一条 INSERT … ON CONFLICT 语义不变(富记录才覆盖),新增写 `board_key`(优先 `parseBoard(applyUrl)`,否则 opts.boardKey)和 `ats`(解析结果),返回 `{inserted, upgraded, duplicates, visaSkipped, locSkipped, errors}`。ingest 接口(§4)复用它。

### 3.3 入库后的接力

不改:去重整合 → 匹配 → 内推建议 → jd_review 接力,抽到 `src/scanner/relay.ts` 的 `runPostScanPipeline(db)` 供 tick 与 ingest 共用。匹配改为"有未打分就一直消化,但每小时最多 `MATCH_HOURLY_CAP`(默认 1500)个":每次 `runMatching` 的 `limit = min(200, cap − 近一小时已打分数)`,tick 每分钟来一次自然形成排队。匹配写入 ≥75 分时调用 `promoteBoardOnHighScore(db, jobId)` 立即升 core。

### 3.4 首次铺开

第 1 天:种子 + 迁移时从库内 URL 解析出的板块(retier 后有高分历史的即 core)+ Workday 核心租户。第 2–4 天:目录导入(`POST /api/sources/import-directory` 或 `npm run import-directory`)把 4725 家写成 longtail,`next_due_at` 在 72 小时内均匀错开。按每小时 1500 的打分节奏约 3 天消化完。

### 3.5 每日重算分级

tick 里当本地时间 03:xx 且当天未跑过 → `retierAll(db)`:按过去 90 天 `jobs.board_key × matches.score` 统计每个板块 ge75/ge60 与"连续 30 天有轮询且零 ≥60",套 §1.4 规则,每次变更写事件。

### 3.6 发布时间

新来源基本自带发布日期(§2 表);iCIMS 缺失则 `posted_at=NULL`。排序里 NULL 按 35 天处理(§5.2)。

## 4. Chrome 通道:扫描 run

### 4.1 为什么

LinkedIn 游客接口拿不到外部申请链接;Handshake 必须登录;Tesla 的接口拒绝脚本请求。只有用户的真浏览器能看全。复用现有值守会话机制:App 排 run,交互式会话接单。

### 4.2 执行器

`ExecutorKind` 新增 `scan`(`src/executor/runner.ts`、`/api/executor/start` 白名单、`executor-panel.tsx` 标签"Chrome 扫描")。仅 `user_chrome`;`headless` 请求返回 400("扫描 run 仅支持值守会话")。options:

```ts
{ sites?: ("linkedin" | "handshake" | "tesla")[]; window?: "24h" | "7d"; maxPerSite?: number }  // 默认 全部 / 24h / 40
```

`/sources` 页的「Chrome 扫描」按钮入队;已有 queued/running 的 scan run 时按钮禁用。

### 4.3 入库接口

- `POST /api/scan/ingest {runId?, jobs: RawJobLike[]}`:zod 校验(source ∈ linkedin|handshake|tesla;applyUrl 必须 http(s);≤200 条/次)→ `upsertJobs` → 更新对应 `chrome:*` 板块 `last_ok_at` → 若有新增且锁空闲则 `runPostScanPipeline` → 返回 upsert 摘要。
- `GET /api/scan/known?urls=<逗号分隔>` → `{known: [url…]}`,让会话跳过已入库的岗,不开详情页。

### 4.4 值守协议(写入 CLAUDE.md §3.12 与 `.claude/skills/scan-executor/SKILL.md`)

只读:不点 Apply、不发消息、不关注、不保存职位。步骤:
1. 接单同 §3.1;日志逐步记。
2. **LinkedIn**(登录态):对 profile 里的方向按 tier 顺序,每方向 2–3 组关键词,打开 `https://www.linkedin.com/jobs/search/?keywords=<kw>&location=United%20States&f_TPR=r86400&f_E=1%2C2&sortBy=DD`(window=7d 用 r604800);read_page 读卡片(标题 / 公司 / 地点 / 发布 / 职位 id);先 `GET /api/scan/known` 过滤;新岗逐个打开详情读正文,读 Apply 按钮:外链型直接取 href(不点击);"Easy Apply" 型 applyUrl 记 LinkedIn 职位页。每站最多 `maxPerSite` 个新岗;页面间隔 3–6 秒;出现验证码 / "unusual activity" 立即停并 finish。
3. **Handshake**:`https://usc.joinhandshake.com/stu/postings?…` 按关键词 + 全职/实习 + 最近 7 天;读卡片与详情;"Apply externally" 的取外链,否则记 Handshake 职位页。
4. **Tesla**:`https://www.tesla.com/careers/search/?query=<kw>&country=US`,关键词 `intern / new grad / software / firmware / autopilot`;详情页取 JD 与本页 URL。
5. 每 10 条 `POST /api/scan/ingest`;结束 `finish` 附摘要(每站新增/重复/跳过)。
6. 节流:每 run 总页面打开 ≤150;LinkedIn 与 Handshake 每天各最多 1 个 run(App 侧不强制,协议约束)。

## 5. UI 与排序

### 5.1 `/sources` 来源页(导航新增「来源」)

- 顶部按 family 汇总卡:板块数(按 tier)、近 30 天新岗、近 30 天 ≥75、24 小时内出错数、上次 tick 时间。
- 板块表:公司 / key、family、tier(下拉可改 → 写 `tier_locked=1`)、上次问 / 状态(ok / 错误摘要)、近 30 天新岗、近 30 天 ≥75、操作(静音 / 恢复、问一次)。筛选:family、tier、关键字;分页 50。
- 最近事件:最近 50 条 `board_retier` 与错误。
- 按钮:立即扫描(核心 + 清单,复用 `/api/scan`)、Chrome 扫描(入队 scan run)、导入开源目录(一次性,显示导入数;再次点击只补新增)。
- API:`GET /api/sources?family=&tier=&q=&page=`、`PATCH /api/sources/board {key, tier}`、`POST /api/sources/poll {key}`、`POST /api/sources/import-directory`。

### 5.2 队列排序与发布时间

- 综合分 SQL 常量(`src/apply/rank.ts`,规则常量与 TS 等价实现在 `src/app/lib/time-penalty.ts`):`COMPOSITE = m.score − 时间惩罚`。
  **2026-09-11 放宽**(用户:知名公司的岗位开了 30 天依然值得优先投;原来 7 天后每 4 天扣 1、封顶 15,会把 89 分、36 天的 ByteDance 岗压到刚发的 80 分小公司岗后面):发布 14 天内不扣;之后每 5 天扣 1,封顶 10(约 64 天到顶);`m.referral_fit = 1`(助手判为「建议内推」的知名公司,即 分≥75 且大厂/知名)减半——每 10 天扣 1,封顶 5;无发布日期按 30 天算(扣 3 / 知名公司扣 1)。详情抽屉显示「排序综合分」和扣分说明,发布列悬停显示扣了几分。
- `QueueSort` 新增 `composite`,方向 tab 默认 `composite`:`ORDER BY a.pinned DESC, COALESCE(m.tier,9) ASC, COMPOSITE DESC, m.score DESC, j.created_at DESC`。`takeNextApplication`、`/api/queue` 无参数的扁平列表同样改用综合分。`pagedAllJobs` 不变。
- /queue 方向 tab 新增「发布」列:相对天数(今天 / 昨天 / N 天前 / —),悬停显示完整日期;≤3 天加「新」chip。排序下拉:综合(默认)/ 分数 / 新鲜度 / 公司名。

### 5.3 执行器面板

runs 列表识别 `scan`(标签「Chrome 扫描」);`/sources` 页嵌入按钮而非整块面板。

## 6. 测试、迁移与上线

### 6.1 测试(vitest,现有 619 全绿为前提)

- `board-key.test.ts`:每个 family 的 URL 样例 → key / ats;不可识别 → null。
- 各适配器:`tests/fixtures/<family>-*.json|html`,假 fetcher 按 URL 分发列表 / 详情;断言字段映射、翻页上限、`isKnownUrl` 跳过详情、非美国过滤、失败抛错。README 表格解析器:`↳` 沿用公司、链接选择、年龄折算。
- `entry-level.test.ts` 补 `isEngineeringTitle`。
- `scheduler.test.ts`:内存库 + 假注册表;到期选择与顺序、budget、状态回写、抖动范围、失败退避、404×5 静音、linkedin 时段、事件写入;`runScan` 包装返回旧形状。
- `retier.test.ts`:§1.4 每条规则、tier_locked、seed 常驻 core、高分立即升。
- `upsert.test.ts`(原 scan-run.test 迁移):富记录覆盖语义不变 + board_key/ats 写入。
- `migration-v12.test.ts`:v11 快照(临时文件)→ openDb → boards 表、jobs.board_key 回填、URL 解析出的 boards 行、retier 后 core。
- `seed-sync.test.ts`、`import-directory.test.ts`(fixture 目录文件、错峰 next_due_at、不覆盖已存在)。
- `rank.test.ts`:综合分排序样例(新 80 分排在 90 天前 88 分之前,排不过新 90 分;NULL 日期按 30 天;知名公司 30 天的 88 分排在新 86 分之前;SQL 与 `timePenalty()` 逐天一致)。
- `ingest.test.ts`:zod 拒绝非法 source / URL / 超量;成功写 board last_ok_at。
- `executor-scan-kind.test.ts`:headless 拒绝、user_chrome 入队、面板标签。
- `readme-table.test.ts`、`linkedin-guest.test.ts`(HTML fixture)。

### 6.2 迁移

`SCHEMA_VERSION = 12`:建表 → 加列 → JS 回填(分批事务)→ 由 URL 建 boards(origin=url)→ 种子同步 → `retierAll`。可重跑(列守卫、`INSERT OR IGNORE`)。上线前备份 `data/backups/jobseeker-<日期>-pre-sources.db`。

### 6.3 上线步骤

1. 分支测试全绿、`npm run build` 通过 → 合入 main。
2. 备份库 → `npm run build && launchctl kickstart -k gui/$(id -u)/com.jobseeker.os` → 迁移自动执行。
3. `curl -X POST /api/scan/tick` 一次,核对 `events.scan_tick` 与 `/sources` 页。
4. 点「导入开源目录」→ 三天内自动铺开;观察 `/sources` 错误列。
5. CLAUDE.md §0/§2/§3.12/§4/§5、README「自动扫描」更新;记忆更新。

## 7. 不做与风险

- 不做:Eightfold、SuccessFactors/Radancy、Google/Microsoft/Meta/Apple 自建站适配器;Rippling/BambooHR/Recruitee/Breezy;人工审批流;扫描通知。
- 风险:Workday / 字节 / LinkedIn 游客接口均为未文档化接口,可能变更——每个适配器独立失败、`/sources` 页可见,修一个不影响其余;LinkedIn 游客接口有条款灰色地带与限流,保守节流并可在来源页静音;目录里的中介公司会带来噪声,靠工程标题门 + 分级沉降 + 匹配器打分三层过滤。
- 所有新列可空、老逻辑不依赖;board 静音不删数据;归档语义不变。
