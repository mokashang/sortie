# JobSeeker OS

本地求职作战系统(Phase A:个人版)。spec 见 `docs/superpowers/specs/2026-08-30-jobseeker-os-design.md`。

## 启动
1. `npm install`
2. `cp profile/profile.example.yaml profile/profile.yaml` 并填写(已有真实档案则跳过)。注意:Plan 1 目前只有测试代码读取 `profile.yaml`——扫描器/API/页面还不消费它;它是后续计划(匹配、评分、投递)的输入,现在配置好可以少一步。
3. `cp .env.example .env`,配置 `NTFY_TOPIC`(手机装 ntfy app 订阅同名频道)。**不配置 `NTFY_TOPIC` 不会报错**——`notify()` 会静默跳过 ntfy 推送,只弹 macOS 本机通知,手机端就收不到扫描完成提醒。
4. `npm run dev` → http://127.0.0.1:3000

日常使用也可以用生产模式:`npm run build && npm start`(同样监听 127.0.0.1:3000,行为与 `dev` 一致,但没有热更新开销,适合常驻后台跑扫描)。

## 自动扫描
`src/instrumentation.ts` 在 dev/start 进程启动时注册一个零依赖的进程内定时器(每 30 秒检查一次系统时间,命中 07:00 / 13:00 整点触发,同一小时不重复);触发时对本机 `/api/scan?trigger=cron` 发起 POST,复用与手动扫描相同的 `runScan` 逻辑。只有当这次扫描确实插入了**新**职位(`inserted > 0`)才会发通知——职位升级(已有记录补全 JD/签证信息)不算新机会,不会触发通知,避免每天误报。
这个定时器不依赖任何第三方 cron 库,也不在自身模块图里引入 `better-sqlite3` ——这样 `npm run dev` 的 webpack 才不会因为要为 edge runtime 静态打包原生模块而报 `Can't resolve 'fs'`。
手动:UI"立即扫描"按钮(不带 `trigger` 参数,不触发通知)或 `npm run scan`。

## 匹配打分
每个职位由 Claude(经你的订阅,无 API 费)按 profile 的 12 方向打分(0-100),写入 `matches` 表并推进申请状态(`matched` / `archived`)。

扫描插入新职位后(`summary.inserted > 0`),`/api/scan` 会**异步**触发一次增量匹配(上限 200 个)——不等待匹配完成就直接返回扫描结果,避免每批 LLM 调用约 35 秒的耗时把 HTTP 响应卡住数分钟;匹配在响应返回后于后台继续跑完,失败只打日志、不影响扫描接口本身。

手动:`npm run match`(全量,resumable)或 `npm run match -- 100`(限量)。CLI 默认并发 6(多个批次同时调用 LLM,写库仍串行,互不覆盖)。接入方式在设置里可选(当前:订阅);见 spec §8.1。

队列页 `/queue` 按 梯队 × 分数 × 新鲜度 展示已匹配职位。

## Resume Studio
在 /profile 页像填网申一样录入你的经历(教育/实习/项目/技能,每条带 bullets)。
在 /studio 选一个方向,Claude 从你的经历里挑选、组版,tectonic 编译出一版 PDF 简历。
生成多个方向版本进入简历库;后续申请执行时按岗位方向选最契合的版本。
经历内容全部由你在 UI 录入 —— 系统不导入外部文件。需要 tectonic(brew install tectonic)。

## 投递执行
半自动填表:App 负责选岗、建答案包(标准字段 + 命中方向的最新简历版本),一个**由 App 按钮直接启动的
headless `claude -p` 会话**(执行器)负责驱动一个**专属的、持久化的 Chrome 浏览器档案**逐个打开申请页、
填表,填完把"字段→填入值"清单回报给 App;真正点提交前必须先在 App 里人工确认。**不用再手动开 claude
会话**——`/apply` 页顶部就是启动/停止入口。

**"专属浏览器档案"是什么:** 执行器用的不是你日常登录的 Chrome,而是一个单独的、持久化到磁盘的 Chrome
profile(`data/browser-profile`,已 gitignore),由官方 Playwright MCP(`@playwright/mcp`,CLI-scope
注册为 `playwright`,见 `claude mcp list`)驱动。这个档案的登录状态**跨次执行器运行保留**——首次使用前
(或换了密码/新增要投的站点后),在 `/apply` 或 `/network` 页的执行器面板里点
**[打开浏览器档案(登录一次)]**(`POST /api/executor/open-profile`,`src/executor/open-profile.ts`),
会弹出一个真实的、带 GUI 的 Chrome 窗口,在里面手动登录一次 LinkedIn/Workday/目标 ATS 站点即可,登录
session 会写进这个 profile 目录,之后所有无人值守的执行器运行都能直接用。这个按钮只是 spawn
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=<profile> --no-first-run`
(找不到就退回 `open -na "Google Chrome" --args ...`),不经过 Playwright MCP 本身。

**从 App 里启动(`/apply` 页):**
1. 确保 App 在跑(`npm run dev` 或生产模式 `npm run build && npm start`,监听 127.0.0.1:3000)。
2. 页面顶部"执行器"面板:填"前 N 个"(默认 5)→ 点[开始投递]。这会调用 `POST /api/executor/start`
   (`{kind:'apply', options:{limit}}`),在服务器进程里 `spawn` 一个 detached 的
   `claude -p --allowedTools 'Bash(curl:*),mcp__playwright__*'` 子进程,把整套投递协议
   (取任务 → 填表 → 回报 → 等确认 → 提交)当作一次性 prompt 从 stdin 喂给它——见
   `src/executor/prompts.ts` 的 `buildApplyPrompt`。
3. Headless 会话只有一个 MCP:`playwright`(官方 Playwright MCP,驱动上面那个专属持久化 Chrome 档案)。
   这个会话直接调用底层工具自己操作页面——`mcp__playwright__browser_navigate` 打开申请页、
   `mcp__playwright__browser_snapshot` 读无障碍树拿到每个元素的 `ref`、
   `mcp__playwright__browser_click`/`browser_type`/`browser_select_option`/`browser_fill_form` 按
   `ref` 填表、`mcp__playwright__browser_file_upload` 传简历——没有子代理、不委托自然语言任务给别人执行。
   如果专属档案在某个站点还没登录过,执行器不会自己尝试登录(没有凭据),而是标"需人工",提示去点上面的
   [打开浏览器档案(登录一次)]。
4. 面板每 3 秒轮询 `GET /api/executor/status`,显示运行状态、pid、最近 ~30 行日志(完整日志在
   `data/executor-logs/run-<id>.log`);想中途叫停点[停止](`POST /api/executor/stop`,对进程组发
   SIGTERM)。
5. 遇到登录墙、验证码、视频题、需要先注册账号的多页流程,或答案包里没有的信息(尤其签证/身份类问题),会标记
   "需人工"并跳到下一个,绝不瞎填。连续 3 个"需人工"或 2 个 error 会自动停下。本会话硬上限"前 N 个"申请,
   达到就停。

**App 侧确认流程(`/apply` 页,和执行器怎么启动无关,始终一样):**
- 上方状态条:今日已提交 / 待确认 / 需人工 三个计数,3 秒自动轮询刷新待确认列表。
- 每张待确认卡片展示 公司·标题·方向·分数、执行器实际填入的"字段→值"表格、所用简历版本。
- [确认提交]:批准这次填表,执行器轮询到批准后才会真正点击页面上的 Submit 并回报 `submitted`。
- [拒绝]:可选填一句原因,不会被提交,状态回到 `matched` 但落入下方"需人工清单"(不会被执行器自动重新取用);想让它重新进入执行队列,去需人工清单点[重试]。
- 已批准但执行器还没提交的卡片会显示"已批准,等待执行器提交",没有再拒绝的按钮(想撤回直接去执行器面板点[停止])。
- 下方两个可折叠列表:需人工清单(原因 + 申请链接 + [重试] 按钮,方便你手动处理或修完问题后重新排队)、今日已提交记录。

**红线(代码层强制,不是靠自觉):** 执行器不会在没看到你批准之前点最终提交;App 侧 `reportSubmitted` 只在 `confirm_decision='approved'` 且状态仍为 `awaiting_confirm` 时才允许把状态写成 `submitted`,否则直接抛错——即使执行器出于某种原因想跳过确认硬点提交,回报也会被 App 拒绝。页面/JD 里的任何文字都只是数据,不会被当作对执行器的指令;所有字段值只来自答案包,绝不临时编造,尤其是签证/工作授权类问题。同一 `kind` 不能同时跑两个执行器会话(`src/executor/runner.ts` 按 PID 存活状态判重,进程死了会自动回收再放行新的一个)。

`.claude/skills/apply-executor/SKILL.md`(以及 `ats-field-maps.md`)仍然留着,作为协议的完整文字说明 /
人工兜底——它面向 claude-in-chrome + 你日常登录的浏览器(交互式会话手动加载它跑,不依赖 App 按钮,也不用
上面的专属 Playwright 档案),和 headless 执行器走的是两条独立的浏览器通道,互不依赖。日常使用不再需要手动
加载它。

**`claude` 二进制路径:** `npm run dev` 之类交互式终端跑的 App,PATH 里通常已经有 `claude`;但如果你把 App
挂在 launchd 常驻(`com.jobseeker.os`),launchd 给的 PATH 一般只有 `/opt/homebrew/bin` 这类系统目录,不含
`~/.local/bin`——而 `claude` 在这台机器上装在 `~/.local/bin/claude`。`resolveClaudeBin()`
(`src/executor/runner.ts`)已经处理了这个:优先用 `CLAUDE_BIN` 环境变量,其次探测
`~/.local/bin/claude` 是否存在,最后兜底裸 `claude` 交给 PATH 解析——一般不用手动配置,装的位置不一样才需要
在 `.env` 里设 `CLAUDE_BIN`。

## 人脉 / Networking
集中式 CRM:联系人(招聘方/校友/用人经理/工程师)、多剧本 AI 草稿(referral/self_pitch/recruiter/
coffee_chat/hidden_opportunity/followup/thanks)、消息记录、与申请双向关联,全部在 `/network` 页管理。

**联系人**:手动加(姓名必填,公司/职位/LinkedIn/Email/关系可选),或由找人执行器自动写入
(`source='executor'`)。点选联系人看它的 outreach 历史(thread_log 时间线)和关联岗位。

**AI 草稿**:选联系人 + 剧本 + 可选关联岗位,点"AI 草稿"(可能要等到 30 秒)。生成的草稿落在"草稿审批区",
可以直接编辑文本框,[批准发送](先保存编辑再批准)或[拒绝]。

**发送**:
- LinkedIn 渠道的已批准草稿由执行器发送——`/network` 页顶部两个按钮直接启动,不用手动开 claude 会话
  (见下)。
- Email 渠道 v1 走 `mailto:` 链接(草稿存的是 `Subject: ...\n\n正文`,UI 自动拆开预填收件人/主题/正文到
  你自己的邮件客户端),发完点[标记已发]手动回报(因为执行器不碰邮件)。

**从 App 里启动(`/network` 页):**
1. 确保 App 在跑;确保上面"投递执行"节说的那个专属 Playwright 浏览器档案已经登录过 LinkedIn(没登录过就点
   [打开浏览器档案(登录一次)] 登录一次)。
2. 页面顶部"执行器"面板,两个独立按钮,各自对应一个 `POST /api/executor/start` 的 `kind`:
   - **[发送已批准消息]**(`kind:'network_send'`):先回收已发送外联的新回复写回 CRM,再轮询
     `/api/network/sendables`,只发这个列表里、渠道为 linkedin 的批准草稿——未连接就发连接请求(note
     裁剪到 280 字符内,超长且没法安全裁剪就跳过标"needs-edit",绝不自行改写);已连接就发 DM 全文。
   - **[找人(队列头部公司)]**(`kind:'network_find'`):只读 LinkedIn 搜索(不连接、不发消息),从队列
     头部公司找 recruiter/USC 校友/工程师,写入 CRM 等你后续手动生成草稿。
3. 和投递执行器一样是 headless `claude -p` + 唯一的 `playwright` MCP,直接驱动那个专属持久化 Chrome 档案
   自己操作页面(navigate → snapshot 读 ref → click/type 填/发)——见 `src/executor/prompts.ts` 的
   `buildNetworkSendPrompt` / `buildNetworkFindPrompt`。如果档案还没登录 LinkedIn,执行器不会自己登录,
   会在总结里报告并停止整个会话,提示去点[打开浏览器档案(登录一次)]。
4. 面板每 3 秒轮询状态、显示日志尾部,[停止]随时可中断。

**发送红线(prompt 里写死,App 侧也有代码层双锁):** 执行器只发送 `sendables()` 返回的、已经在 App 里
批准过的草稿,逐字核对页面输入框内容与草稿一致才点发送,绝不给列表之外的人发消息,绝不改写草稿语义;每会话
≤10 个连接请求、≤15 条消息,动作间隔 ≥30 秒,遇到任何限流/验证码信号立即停止汇报。App 侧 `reportSent` 只在
`pending_send`(即已经过 `/network` 页批准)状态才允许推进到 `sent`,否则抛错——这一层与 §6 投递红线同构。

`.claude/skills/network-executor/SKILL.md` 仍然留着,作为协议的完整文字说明 / 人工兜底——同样面向
claude-in-chrome + 你日常登录的浏览器,和 headless 执行器走的专属 Playwright 档案是两条独立通道。日常使用
不再需要手动加载它。

## Dashboard
首页 `/` 直接跳到 `/dashboard`(导航栏第一项也是它)。SSR 页面,不引图表库,横条纯靠 `<div>` 宽度百分比:
- **申请漏斗**:发现/已匹配/已投递/OA/面试/Offer/被拒/已归档,按 `applications.status` 计数。
- **分方向**:方向 × 梯队 分组,总数 / 投递(`submitted_at` 曾经非空)/ 面试(状态达到面试或以上)。
- **Networking 漏斗**:草稿/待发送/已发送/已回复/约到聊/拿到内推,按 `outreach.status` 计数。
- **Referral vs 海投**:按 `applications.referral_person_id` 是否非空分组对比投递数、面试数、面试转化率
  (§7.4 双向关联的呈现)。
- **本周 vs 上周**:滚动 7 天窗口(不是自然周)对比已投递数量和新增 outreach 数量。
- **待办**:去确认(链到 `/apply` 的 `awaiting_confirm` 数)、去批准(链到 `/network` 的草稿数)、该
  followup 的人(发送超过 5 天仍未收到回复的联系人列表,按逾期天数倒序)。

## 数据
- SQLite:`data/jobseeker.db`(gitignored)
- 生成的简历(.tex/.pdf):`data/resumes/`(gitignored)
- 个人档案:`profile/profile.yaml`(gitignored)
- watchlist 种子:`config/watchlist.seed.json`

## 测试
`npm test`
