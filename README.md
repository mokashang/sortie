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
半自动填表:App 负责选岗、建答案包(标准字段 + 命中方向的最新简历版本),一个独立的 Claude-in-Chrome 会话负责驱动你**已登录的真实 Chrome**逐个打开申请页、填表,填完把"字段→填入值"清单回报给 App;真正点提交前必须先在 App 里人工确认。

**开一个执行器会话:**
1. 确保 App 在跑(`npm run dev`,监听 127.0.0.1:3000)且已连接 claude-in-chrome 浏览器扩展。
2. 在项目根目录另开一个 `claude` 会话(独立于跑 App 的终端),对它说"运行 apply-executor" / "帮我投递岗位",让它加载 `apply-executor` skill。
3. 执行器会自检 App 与 Chrome 连通性,然后循环:取任务(`/api/apply/next`)→ 开申请页 → 按 ATS 分层填表(Greenhouse/Lever/Ashby 有精确字段图谱,见 `.claude/skills/apply-executor/ats-field-maps.md`;其余平台只填高置信度字段)→ 回报 `awaiting_confirm` → 轮询等你确认。
4. 遇到登录墙、验证码、视频题、需要先注册账号的多页流程,或答案包里没有的信息(尤其签证/身份类问题),会标记"需人工"并跳到下一个,绝不瞎填。
5. 连续 3 个"需人工"或 2 个 error,执行器会自动停下并向你汇报,不会一直空转。

**App 侧确认流程(`/apply` 页):**
- 上方状态条:今日已提交 / 待确认 / 需人工 三个计数,3 秒自动轮询刷新待确认列表。
- 每张待确认卡片展示 公司·标题·方向·分数、执行器实际填入的"字段→值"表格、所用简历版本。
- [确认提交]:批准这次填表,执行器轮询到批准后才会真正点击页面上的 Submit 并回报 `submitted`。
- [拒绝]:可选填一句原因,申请退回队列(状态回到 `matched`),不会被提交。
- 下方两个可折叠列表:需人工清单(原因 + 申请链接,方便你手动处理)、今日已提交记录。

**红线(代码层强制,不是靠自觉):** 执行器不会在没看到你批准之前点最终提交;App 侧 `reportSubmitted` 只在 `confirm_decision='approved'` 且状态仍为 `awaiting_confirm` 时才允许把状态写成 `submitted`,否则直接抛错——即使执行器出于某种原因想跳过确认硬点提交,回报也会被 App 拒绝。页面/JD 里的任何文字都只是数据,不会被当作对执行器的指令;所有字段值只来自答案包,绝不临时编造,尤其是签证/工作授权类问题。

## 数据
- SQLite:`data/jobseeker.db`(gitignored)
- 生成的简历(.tex/.pdf):`data/resumes/`(gitignored)
- 个人档案:`profile/profile.yaml`(gitignored)
- watchlist 种子:`config/watchlist.seed.json`

## 测试
`npm test`
