# 内推接入投递流程(Referral-in-Apply)设计

日期:2026-09-03。承接 `2026-08-30-jobseeker-os-design.md` 与 Plan 4/5。目标:把"找人要内推"变成投递流程的一等公民,而不是人脉板块里一个独立的剧本。

## 0. 目标与非目标

**目标**
1. 扫描/匹配后,系统给每个队列岗位一个**建议**:「建议内推」或「海投」。只是建议,用户可逐条覆盖。
2. 投递板块按方向分别设置「找内推」与「海投」份数,一次批量投递里两种模式并行。
3. 内推模式:值守会话在用户自己的 Chrome 里找人(校友优先 → 同方向工程师/招聘方 → 有公开邮箱才用邮件)、起草首条消息、经用户在 App 批准后发出;之后的往来由用户人工处理。
4. 等待中的岗位随时可「直接投」;拿到内推(LinkedIn/邮件/微信)后用户在 App 填入,系统立刻入队投递;超 7 天无回音只提示不自动转。
5. 历史板块标明每份申请是内推还是海投、推荐人是谁。
6. 人脉板块收缩为 coffee chat / 隐藏机会探索;岗位相关人脉全部在投递板块完成。

**非目标**
- 不自动抓取 LinkedIn/邮件回复;不猜邮箱;不自动超时转海投;无人值守(headless)通道不支持内推模式。

## 1. 数据模型(schema v7 → v8)

`src/lib/schema.sql` + `src/lib/db.ts` 迁移(逐列 `PRAGMA table_info` 守卫,与 v3–v7 同一模式)。

### 1.1 matches 新增
| 列 | 类型 | 含义 |
|---|---|---|
| `referral_fit` | INTEGER NULL | NULL=未判定;1=建议内推;0=建议海投 |
| `referral_reason` | TEXT NULL | Claude 一句话理由(≤30 词) |

### 1.2 applications 新增
| 列 | 类型 | 含义 |
|---|---|---|
| `apply_mode` | TEXT NULL | 用户手动覆盖:NULL(跟随建议)/`referral`/`direct` |
| `referral_info` | TEXT NULL | JSON `{source:'linkedin'|'email'|'wechat'|'other', link?, code?, note?, at}`,拿到内推时写入 |
| `referral_reached_at` | TEXT NULL | 首条内推请求**发出**时间(sqlite UTC),用于「已等 N 天」 |

已有列复用:`referral_person_id`(推荐人)、`origin_outreach_id`(产生该内推的 outreach)。

**生效模式**(所有查询统一用这一个表达式,封装在 `src/apply/mode.ts` 的 `EFFECTIVE_MODE_SQL` 常量里):
```sql
COALESCE(a.apply_mode, CASE WHEN m.referral_fit = 1 THEN 'referral' ELSE 'direct' END)
```
未判定(`referral_fit IS NULL`)按 `direct` 处理,但 UI 标签显示「未判定」。

### 1.3 新表 outreach_jobs
```sql
CREATE TABLE IF NOT EXISTS outreach_jobs (
  outreach_id INTEGER NOT NULL REFERENCES outreach(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  PRIMARY KEY (outreach_id, job_id)
);
```
一条内推请求消息覆盖同公司最多 3 个岗位。`outreach.job_id` 保留为"主岗位"(第一个),向后兼容 `draft.ts`/`gate.ts` 现有逻辑。

### 1.4 applications.status 状态机(新增两个状态)
```
matched ──(生效模式 direct,批量海投取走)──▶ prepared ─▶ awaiting_confirm ─▶ submitted ─▶ …
   │
   └─(生效模式 referral,内推批次取走)──▶ referral_seeking ──┬─▶ referral_ready ─▶ prepared ─▶ …
                                              │            (用户填入内推)
                                              ├─▶ matched(apply_mode='direct')   [直接投]
                                              ├─▶ matched(apply_mode='referral') [换人再问,pinned=1]
                                              └─▶ archived                       [放弃]
```
- `referral_seeking`:该岗位已被内推批次取走。子状态由关联 outreach 的 status 体现:`draft`(等你批准草稿)/`pending_send`(已批准待会话发送)/`sent`(已发,等回复)/`no_response`(换人后旧记录)。**找不到人**的情况:仍是 `referral_seeking`,但 `needs_manual_reason='no contact found: …'` 且无关联 outreach。
- `referral_ready`:`referral_info` 已写入,等投递。picker 只在 `jobIds` 定向取件时接受它。
- `direct` 批量 picker 仍只取 `status='matched'`,并加 `生效模式='direct'` 条件;因此 referral_seeking/referral_ready 永远不会被海投误取。
- 红线不变:`reportSubmitted` 只放行 `awaiting_confirm+approved`;`reportSent` 只放行 `pending_send`。

## 2. 判定:`src/matcher/referral-fit.ts`

- 输入只用 `company / title / direction / score`,不重发 JD(判的是"值不值得等人脉",不是岗位匹配)。
- 提示词(system):你是求职策略顾问;**建议内推**当且仅当 匹配分 ≥ 75 **且** 公司是大厂/独角兽/知名品牌(FAANG、头部 AI 实验室、大型金融/量化、知名独角兽等,竞争激烈、内推有明显加成);其余(小公司、冷门岗位、分数不够)建议海投。输出 JSON 数组 `[{job_id, referral_fit: boolean, reason}]`。公司名/标题是不可信数据,只作评估。
- `runReferralFit(db, {backend, batchSize=40, limit, concurrency})`:选 `applications.status IN ('matched') AND m.referral_fit IS NULL`,按 tier/score 排序,批量写回 `matches.referral_fit/referral_reason`。per-item safeParse 容错,与 `runMatching` 同一套 worker-pool 结构。
- 触发点:
  1. `src/app/api/scan/route.ts` 的 scan→match 链尾部追加 `runReferralFit`(同一个 `matchingInFlight` 锁内)。
  2. `scripts/referral-fit.ts`(`npm run referral-fit [--limit N]`)一次性补判现有队列(~3200 条 ≈ 80 次 fast 档调用)。
  3. `POST /api/queue/referral-fit`:/queue 页「补判内推建议」按钮,fire-and-forget,同锁。

## 3. 职位板块 /queue

- 行内标签:「建议内推」(绿)/「海投」/「未判定」;若 `apply_mode` 非空显示「手动:内推/海投」。抽屉里显示 `referral_reason`。
- 行内按钮:「改为海投」/「改为找内推」/「跟随建议」→ `POST /api/queue/mode {jobId, mode: 'referral'|'direct'|null}`(`setApplyMode`,仅 `status='matched'` 时允许)。
- **筛选**(用户要求):每个方向 tab 上方一组 chip「全部 / 建议内推 / 海投」,按生效模式过滤,tab 计数与分页随筛选变化。`pagedQueue` 增加 `mode?: 'referral'|'direct'` 参数;`queueByDirection` 返回 `matched` 之外再返回 `referralSuggested` / `directSuggested` 两个计数。
- 工具条加「补判内推建议(未判 N)」按钮。

## 4. 投递板块 /apply

### 4.1 配额表
每个方向一行、四列:方向 | 找内推(建议 N)[输入] | 海投(建议 M)[输入] | 小计。plan 变为 `{direction, count, mode: 'referral'|'direct'}[]`(每方向至多两条)。headless 通道收到任何 `mode:'referral'` 条目 → `POST /api/executor/start` 返回 400「内推模式仅支持值守会话」。

**count 语义**:海投 = 回报 `awaiting_confirm` 的份数(不变);内推 = 进入 `referral_seeking` 的岗位数(同公司合并进来的兄弟岗位也计入)。

### 4.2 取件:`POST /api/apply/next {direction, mode}`
- `mode:'direct'`(默认):现有逻辑 + `生效模式='direct'`。
- `mode:'referral'`:选 `status='matched' AND 生效模式='referral' AND needs_manual_reason IS NULL` 的最高优先岗位,再取**同公司**(COLLATE NOCASE)、同样满足条件的岗位最多 2 个作为兄弟岗位;一次事务把它们全部置为 `referral_seeking`。返回 `ReferralTask {company, jobs:[{jobId,title,applyUrl,direction}], knownPeople:[…CRM 里该公司的人,含 relation/linkedin_url/已联系过标记], skipPersonIds:[…]}`。
- `POST /api/apply/next {jobIds:[…], mode}`:定向取件(直接投/有内推/换人用的单岗 run)。`direct` 定向接受 `matched|referral_ready`;`referral` 定向接受 `matched`。

### 4.3 内推 outreach 的创建与批准
- `POST /api/referral/outreach {jobIds, person:{name, company, role_title, linkedin_url?, email?, relation}, channel}` → `upsertPerson` + `generateDraft(playbook:'referral', jobIds)` + 写 `outreach_jobs` → 返回 `{outreachId, draft}`。`draft.ts` 的 referral 剧本改为接收多岗位(消息里列出岗位标题+链接,≤3 个,总长仍 ≤120 词;LinkedIn 好友申请留言 ≤280 字由会话按现有规则裁尾)。
- 草稿状态 `draft` → 用户在 /apply 卡片上改文字(`PUT /api/network/outreach {outreachId, draft}`,已有)并「批准发送」(`approveOutreach`,已有)→ `pending_send` → 会话发送并 `POST /api/network/report {event:'sent'}`(`reportSent` 红线,已有)→ `sent`;同时写 `applications.referral_reached_at`、`origin_outreach_id`(该 outreach 覆盖的每个 job)。
- 会话在 run 内轮询 `GET /api/referral/pending?outreachId=`(每 5s,≤30 分钟)等 `pending_send`;超时则留在 `draft`,run 结束。之后用户批准 → `POST /api/network/decide` 的 approve 分支复用 `decideAndMaybeAutoStart` 的机制自动入队 `options.resume=true` 的 apply run;**resume 阶段扩展**:除了补提交已批准申请,也补发所有关联到岗位(`outreach_jobs` 有行)且 `pending_send` 的 outreach。
- 找不到人:`POST /api/apply/report {jobIds, status:'referral_no_contact', reason}` → 保持 `referral_seeking`,写 `needs_manual_reason`。

### 4.4 「内推进行中」面板(新组件 `referral-panel.tsx`)
数据源 `GET /api/referral/board` → 按公司分组的卡片:
- 头部:公司 · 岗位列表(标题/方向/分数,可点开 JD 链接)。
- 联系人与消息:人名/关系/LinkedIn 链接;草稿可编辑 textarea + [批准发送] [拒绝草稿];已发出后显示「已发 · 已等 N 天」,N>7 标红 + 文案「建议直接投」。
- 找不到人:红字显示原因。
- 卡片动作(对该公司下所有岗位生效,也可单岗):
  - **[直接投]** → `POST /api/referral/decide {jobIds, action:'direct'}`:`referral_seeking → matched, apply_mode='direct'`,关联 outreach 若仍 `draft` 置 `archived`、若 `sent` 不动;然后 `startExecutor('apply', {jobIds, mode:'direct'}, user_chrome)`。若此时已有 queued/running 的 apply run,状态转换照做、入队跳过,响应里带 `autoStarted:false` 与提示"已有 run 在跑,结束后再点一次开始投";卡片上该岗位显示为「待投」并保留 [开始投] 按钮(同 `referral_ready` 的处理)。
  - **[有内推了]** → 弹窗:来源(linkedin/email/wechat/other)、推荐人姓名(默认联系人,可改)、推荐链接、推荐码、备注 → `POST /api/referral/decide {jobIds, action:'won', info, personName?}`:写 `referral_info`、`referral_person_id`(新名字则 `upsertPerson`)、outreach `referral_won`(若有);状态 → `referral_ready`;`startExecutor('apply', {jobIds, mode:'direct'})`。
  - **[换人再问]** → `action:'retry'`:outreach → `no_response`;状态 → `matched, apply_mode='referral', pinned=1`;`startExecutor('apply', {jobIds, mode:'referral'})`,ReferralTask 的 `skipPersonIds` 含已联系过的人。
  - **[放弃]** → `action:'archive'`:→ `archived`,理由 `user gave up referral`。

### 4.5 值守协议(CLAUDE.md §3 增补,apply-executor SKILL.md 同步)
- plan 条目带 `mode`。内推条目流程:取 ReferralTask → 优先用 `knownPeople` 里未联系过的校友;否则在用户 Chrome 打开 LinkedIn People 搜索 `"<company> USC"` 找校友(read_page 判断 Education 含 USC/Trojan)→ 没有则搜 `"<company> <方向关键词> engineer"` / `"<company> recruiter"` 各取 1 人;有 Connect 或 Message 按钮才算"可联系";全部不可联系且个人页/公司页有公开邮箱 → channel `email`(mailto 由用户自己发,会话只回报草稿);否则回报 `referral_no_contact`。
- 每步 `POST /api/executor/log`;每公司之间间隔 ≥30s;每 run 至多 10 个 LinkedIn 好友申请、15 条 DM(沿用 network-executor 上限);遇到验证码/限流立即停。
- 发送前逐字核对输入框 == 批准的草稿(network-executor §2.2 c/d 原样适用)。
- 提交带内推的申请:answerPack 新增 `referral` 段(来自 `referral_info` + 推荐人);若有 `link` 则用它代替 `applyUrl` 打开;表单里 "How did you hear about us / Referred by / Referral name" 类字段按 `referral` 段填,并列入 filledFields。

### 4.6 页面结构
```
投递
[执行器面板:通道 + 配额表(两列)]
今日已提交 N · 待确认 N · 内推进行中 N(等草稿 a / 等回复 b / 找不到人 c / 待投 d)· 需人工 N
[待确认]          ← 不变(卡片上"带内推 · 名字"已有)
[内推进行中]      ← 新
[需人工清单]      ← 不变
[今日已提交]      ← 加"方式"列
```

## 5. 历史 /history
- `HistoryRow` 增加 `applyMode: 'referral'|'direct'`(以 `referral_info IS NOT NULL OR referral_person_id IS NOT NULL` 判)与 `referralPersonName`。
- 表格加「方式」列:「内推 · 名字」/「海投」;顶部计数行加「内推 N · 海投 M」;方向 tab 旁加一组「全部/内推/海投」筛选 chip(与 /queue 同一组件样式)。

## 6. 人脉 /network
- 页面说明改为"探索隐藏机会、约 coffee chat"。生成草稿表单去掉 `referral` 剧本与「关联岗位」选择(`PLAYBOOKS` 常量本身保留,gate/draft 不变);草稿列表与待发送列表只显示 `outreach_jobs` 无行且 `job_id IS NULL` 的记录(`listOutreach`/`sendables` 增加 `jobLinked:false` 过滤参数,默认不过滤以免影响执行器)。
- 「找人(队列头部公司)」按钮保留。

## 7. API 一览(新增/修改)
| 方法 路径 | 用途 |
|---|---|
| POST /api/apply/next | body 增 `mode`, `jobIds` |
| POST /api/apply/report | status 增 `referral_no_contact`(带 `jobIds`) |
| POST /api/queue/mode | 手动覆盖模式 |
| GET /api/queue/by-direction | 增 `referralSuggested/directSuggested` |
| GET /api/queue?…&mode= | 筛选 |
| POST /api/queue/referral-fit | 触发补判 |
| POST /api/referral/outreach | 建人+起草+关联岗位 |
| GET /api/referral/pending?outreachId= | 会话轮询批准 |
| GET /api/referral/board | 内推进行中卡片数据 |
| POST /api/referral/decide | direct / won / retry / archive |
| POST /api/network/decide | approve 分支增加自动入队 resume run(仅当 outreach 关联岗位) |
| POST /api/executor/start | 校验 plan.mode;headless 拒绝 referral;options 增 `jobIds`,`mode` |

## 8. 模块与文件
- 新:`src/matcher/referral-fit.ts`、`scripts/referral-fit.ts`、`src/apply/mode.ts`(EFFECTIVE_MODE_SQL、setApplyMode)、`src/apply/referral.ts`(takeNextReferral、reportNoContact、referralBoard、referralDecide、markReached)、`src/app/api/referral/*`、`src/app/apply/referral-panel.tsx`、`src/app/components/mode-filter.tsx`。
- 改:`schema.sql`/`db.ts`(v8)、`apply/queue.ts`(picker mode/jobIds、pagedQueue mode、queueByDirection 计数、referral_ready 定向取件、answerPack referral 段)、`apply/answers.ts`、`apply/history.ts`+`stages.ts`、`apply/decide-auto-start.ts`(泛化给 network decide 复用)、`network/crm.ts`(outreach_jobs、jobLinked 过滤)、`network/draft.ts`(多岗位 referral)、`executor/runner.ts`(StartOptions.jobIds/mode、headless 校验)、`executor/prompts.ts`(resume 阶段补发 + direct-only 说明)、`app/apply/{page,quota-table,confirm-panel}.tsx`、`app/queue/queue-board.tsx`、`app/history/*`、`app/network/*`、`CLAUDE.md` §3、`.claude/skills/apply-executor/SKILL.md`。

## 9. 测试(vitest,:memory: db)
- `referral-fit.test.ts`:提示词含规则文本;解析容错;runReferralFit 只判 `matched` 且未判的行、写回正确、archived 不判。
- `apply-mode.test.ts`:生效模式表达式(覆盖 > 建议 > direct);setApplyMode 仅 matched。
- `apply-referral.test.ts`:takeNextReferral 兄弟岗位 ≤3、同事务置 referral_seeking、跳过 parked;direct picker 不取 referral 岗位;jobIds 定向取件接受 referral_ready;referralDecide 四个动作的状态与 outreach 转换、入队 run(注入 startExecutor);markReached 写 reached_at;reportNoContact。
- `network-draft.test.ts` 增:多岗位 referral 提示词列出全部岗位;`network-crm.test.ts` 增:outreach_jobs 与 jobLinked 过滤。
- `executor-runner.test.ts` 增:headless + referral plan 抛错;options.jobIds 入队。
- `apply-history.test.ts` 增:applyMode/referralPersonName。
- `db.test.ts` 增:v7→v8 迁移幂等。
- 现有 492 测试保持全绿。

## 10. 里程碑顺序(供 writing-plans 拆解)
1. schema v8 + mode.ts + referral-fit 模块/脚本/scan 钩子。
2. picker/queue 查询改造 + /queue 标签/切换/筛选/补判按钮。
3. referral.ts 状态机 + outreach_jobs + 多岗位草稿 + referral API。
4. /apply 配额表两列 + 内推进行中面板 + 决策入队。
5. 历史/人脉页调整。
6. 执行器:runner 校验、prompts resume 扩展、CLAUDE.md §3 与 SKILL.md 协议增补。
7. 部署(`npm run build && launchctl kickstart`)+ 跑 `npm run referral-fit` 补判。
