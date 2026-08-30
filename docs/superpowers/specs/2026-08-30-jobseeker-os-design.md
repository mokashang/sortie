# JobSeeker OS — 系统设计文档

日期:2026-08-30
用户:Mengjia Shang(USC M.S. ECE,2025.09–2027.05,F-1,CPT/OPT)
状态:设计已与用户逐节确认

---

## 1. 目标与范围

### 1.1 求职目标(优先级排序)
1. **主目标:2027 New Grad 全职**(2026 秋招主战场,毕业后入职)
2. **次目标:Summer 2027 实习**(兜底,如全职未落地)
3. **机会性:Spring 2027 学期实习/co-op**(CPT 政策受限,大概率做不了,遇到合适的可试)

### 1.2 岗位方向(12 方向全覆盖,按梯队定优先级)

| 梯队 | 方向 |
|---|---|
| T1 | SDE/SWE(后端/全栈/平台)、AI Infra/ML Systems、MLE/Applied ML、Quant Dev/Research |
| T2 | Embedded/Firmware、Systems/Kernel/Performance、Robotics/Autonomy SW、SRE/Infra/DevOps |
| T3 | Data Science/DE/Analytics、Security Engineering、EDA/Verification 软件岗、GPU/CUDA 性能岗 |

### 1.3 范围边界
- **Phase A(本设计)**:用户本人的完整求职作战系统,跑在用户 Mac 本地
- **Phase B(不在本设计内,但为其打地基)**:泛化成任何专业的人可用的产品 + 社交媒体推广。Phase A 通过 profile 抽象(见 §8)保证零重构过渡

### 1.4 核心原则
- **半自动红线**:系统填表、写草稿;**提交申请和发送消息永远由用户在前端点击确认**。此规则在代码层写死,不依赖 LLM 自觉
- **用户只碰前端**:确认、查看、设置全部在 Web UI 完成,用户永不进后台/终端
- **判断活由 Claude 干,不用硬编码脚本**:JD 匹配打分、简历选择、草稿撰写全部由 LLM 完成;脚本只做确定性工作(抓取、去重、存储、调度、统计)
- **每日用户时间预算 1–2 小时硬上限**:队列按价值排序,保证时间花在最值钱的申请上

---

## 2. 总体架构

技术栈:**Next.js(前后端一体)+ SQLite**,本地单进程,浏览器访问 `localhost`。

```
┌────────────────── Web UI(用户唯一操作面)──────────────────┐
│ Dashboard │ 申请确认队列 │ Networking CRM │ 职位浏览 │ 设置/Profile │
└──────────────────────────┬─────────────────────────────┘
┌──────────────────────────┴─────────────────────────────┐
│ App 服务层(Next.js 常驻进程)                              │
│ 调度器(node-cron) · 队列管理 · 通知(macOS+ntfy) · API     │
└───────┬──────────────┬───────────────┬─────────────────┘
  [扫描引擎]       [判断引擎 = Claude]     [执行引擎 = Claude + 用户 Chrome]
  GitHub 清单     JD↔方向匹配打分          填申请表(停在提交前)
  ATS 公开 API    选最契合简历版本          LinkedIn 找人/填草稿
  (无需登录)      写 networking 草稿       (需登录态,用户接手时运行)
        └──────────────┴───────────────┴──────────┐
              SQLite 数据库 + profile/ 目录(泛化关键)
```

- **判断引擎**:App 通过 Claude Agent SDK 无头调用 Claude;扫描完成后自动执行,不需用户在场
- **执行引擎**:需要用户 Chrome 的登录态(LinkedIn/Workday 等),在用户于 UI 点"开始处理"后由 Claude 经 claude-in-chrome 驱动真实浏览器执行
- **启动**:launchd 保证 App 开机常驻;调度器在进程内触发定时任务

## 3. 数据模型(SQLite)

- **jobs** — 公司、标题、地点、JD 全文、来源、发布时间、ATS 类型、apply URL、去重指纹(公司+标题+地点)
- **matches** — job_id、方向、匹配分(0–100)、梯队、选用简历版本、理由、跳过原因(如"明确不 sponsor")
- **applications** — 状态机:`发现→已匹配→已备好→待确认→已提交→OA→面试→offer/拒/失效`;提交时间、所用简历、填表截图、确认截图;**referral_person_id(可空:此申请带的内推人)、origin_outreach_id(可空:此岗位经哪次 networking 发现/获得)**
- **people** — 姓名、公司、职位、LinkedIn URL、邮箱(推测/已验证)、关系类型(recruiter/USC 校友/hiring manager/同组工程师)、来源
- **outreach** — person_id、关联 job_id(可空,coffee chat 等可无岗位)、剧本类型、渠道(LinkedIn/email)、草稿全文、**完整消息往来记录**、状态:`草稿→待发→已发→已回→约上/内推到手/无回应`、**产出记录(此次触达带来的 referral/内推码/隐性岗位线索,回链到 applications)**
- **companies** — watchlist:名称、梯队、ATS 平台、career page/API URL、监控开关
- **resumes** — 版本名、适配方向列表、LaTeX 源路径、PDF 路径、最后编译时间
- **events** — 全量事件流水(dashboard 统计源)
- **profile** — 用户个人信息(见 §8)

## 4. 扫描引擎(信息源分梯队)

| 梯队 | 源 | 频率 | 方式 |
|---|---|---|---|
| T1 | GitHub 新人岗清单(SimplifyJobs New-Grad、Summer 2027 Internships 等 4–6 个 repo) | 每天 2 次(7:00 / 13:00) | 脚本,无需登录 |
| T1 | watchlist 公司 Greenhouse/Lever/Ashby 公开 JSON API 直轮询 | 每天 2 次 | 脚本,无需登录,秒抓数百家 |
| T2 | LinkedIn Jobs(12 方向对应 6–8 组搜索词,过滤"过去 24h") + Handshake | 每 2–3 天 | 需用户 Chrome;在用户接手处理队列时后台顺带跑(UI 勾选) |
| T3 | 无公开可编程接口、需人工浏览的渠道(精确定义见下) | 每周 | UI 生成带勾选的检查清单 |

**Tier 3 精确定义** — 判定标准:该源既无公开 JSON API 可轮询、也无法用无登录脚本稳定抓取,必须人工(或借用户登录态的浏览器)浏览。具体枚举:
1. **ATS 无公开接口的大厂 career site**:Taleo/SuccessFactors/iCIMS 及自研系统(如部分银行、传统巨头)。注:Workday 多数站点实际暴露 CXS JSON 端点(`/wday/cxs/.../jobs`),**建库时逐家探测,能轮询的归入 T1**,探测失败的才留在 T3
2. **学校渠道**:USC Viterbi career portal、系里邮件列表转发的岗位、career fair/info session 日程
3. **社群渠道**:一亩三分地求职版、r/csMajors 等 subreddit 周贴、CS/quant 求职 Discord/Slack 群、Blind
4. **快速入库通道**:UI 提供"粘贴岗位 URL"一键入库,任何 T3 渠道人工看到的岗位贴进来即走正常匹配→队列流水线
每个 T3 源在 UI 检查清单里记录"上次查看时间",按各自建议频率(默认每周)提醒。

- **watchlist**:由 Claude 按 12 方向初始生成 100–150 家(quant firms、FAANG+一线、AI labs、独角兽、robotics/embedded 名企),用户在 UI 增删
- **签证过滤**:JD 检测"不 sponsor / 仅公民绿卡 / 需 security clearance"→ 自动标记跳过;UI 可翻案。此为唯一允许关键词规则的环节(黑白分明)
- **去重**:跨源统一指纹去重;已见 job 不重复入队

## 5. 匹配引擎 + 简历库

### 5.1 简历引擎(Resume Studio,系统内嵌)
用户明确要求:简历不是"做好 8–10 版上传进系统",而是**系统内置一个从 profile 生成方向简历的引擎**,这也是 Phase B 泛化的核心卖点之一。

- **经历素材库(素材层)**:profile 内的结构化经历数据库——每段实习/项目/研究/课程拆成模块,每个模块含多条 bullet 变体并标注方向相关度(同一个项目对 AI Infra 强调分布式训练、对 Embedded 强调实时约束)
- **生成层**:Claude 按目标方向从素材库选模块、组 bullet → 套 LaTeX 模板 → 系统内编译 PDF
- **UI(Resume Studio 页面)**:预览各版 PDF、逐条编辑 bullet、一键重新生成、版本对比;定稿的 8–10 版进入简历库供匹配引擎选用
- **导入通道**:一次性解析现有材料(`~/Documents/resume/` 两套 LaTeX、resume_info_db.json、历史 PDF)填充素材库 → 引擎生成补充信息问题清单 → 用户在 UI 里抽空回答补齐
- **明确不做 per-JD 微调**(用户判断:工作量大、边际收益低)。每岗位由 Claude 从定稿库中选最契合版本

### 5.2 匹配(Claude 判断,非脚本)
每个新职位,Claude 读 JD 全文 + 用户 profile,输出:方向分类、匹配分 0–100、梯队、选用简历版本、一句话理由。低于阈值(默认 40,UI 可调)自动归档。队列按 `梯队 × 匹配分 × 新鲜度` 排序。

## 6. 申请执行(半自动)

1. 用户在 UI 点"开始处理" → Claude 接管用户 Chrome,按队列逐个打开 apply 页填表(Greenhouse/Lever/Workday/自有系统),用所选简历 PDF、profile 标准答案(签证如实填:需要 sponsorship)
2. 填到提交前一步停下,截图 → **UI 弹出预览** → 用户点"确认" → Claude 点提交、存确认截图、更新状态 → 自动下一个
3. 用户随时暂停离开,队列常驻;填不动的表单(视频题、奇葩流程)标记"需人工"进单独清单
4. **代码层红线**:执行引擎无"确认记录"则拒绝执行提交动作

## 7. Networking 引擎(内置集中式 CRM)

### 7.1 原则(用户确认)
- **岗位驱动、有目的性**:主体 outreach 挂靠具体申请/岗位,不设"每天硬凑 N 封"的死指标;设**最低保底量**兜底,同时容纳无岗位挂靠的探索性触达(挖掘未公开岗位、coffee chat)
- **先信任后连接**:优先 cold email 建立语境,再发 LinkedIn connect;不发无 note 的裸 connect
- **LinkedIn 每周连接额度(~100)拉满**,由系统按目标价值分配预算
- **草稿制**:一切消息先草稿,用户在 UI 过目后点发送。LinkedIn 消息:用户在 UI 点"发送"后由 Claude 经用户浏览器代点发出;email:用户在 UI 点"发送"后经 Gmail 发出,发送记录同步回 CRM

### 7.2 剧本库(按情境自动选)
1. **Referral 请求**(投递前优先):向校友/在职工程师要内推
2. **毛遂自荐**:雷达发现"我们组在招人"的帖子 → 直接自荐
3. **Recruiter 直联**:申请后告知 recruiter 背景高度匹配
4. **Coffee chat 邀约**:对 T1 梦想公司校友,先约 15 分钟,不直接要东西(可不挂岗位)
5. **隐性机会挖掘**:与目标公司/组的人聊,探未公开 headcount
6. **Follow-up**:已发未回 5–7 天自动生成跟进草稿;面试后感谢信
- 触达对象来源:每个 T1/T2 申请自动搜该公司 recruiter、USC 校友、目标组工程师/HM;扫 LinkedIn 顺带识别招人帖进"高价值机会队列"

### 7.3 集中式 CRM(用户明确要求)
所有联系人、每条已发/已收消息、状态流转、关联岗位,**全部在前端一个页面查看管理**,用户无需去 LinkedIn/Gmail 翻找记录。回复通过用户接手时的浏览器会话同步回系统。

### 7.4 与申请子系统的双向交互(独立又互联)
两个子系统各自独立统计、但通过外键双向关联:
- **Networking → 申请**:一次 outreach 拿到 referral → 记入 outreach 产出,对应申请标记 `referral_person_id`;coffee chat 聊出未公开岗位 → 手动/自动建 job,申请标记 `origin_outreach_id`
- **申请 → Networking**:每个 T1/T2 申请自动生成配套 outreach 任务(投前要 referral、投后联 recruiter);申请进入面试/offer 状态时,提示给相关联系人发感谢/更新消息
- **独立统计**:Networking 有自己的漏斗(发出→回复→约上→产出);申请有自己的漏斗(投递→OA→面试→offer)
- **交叉统计**:带 referral 的申请 vs 海投的转化率对比、各剧本类型带来的面试数、经 networking 发现的岗位占比——这是校准策略的核心数据
- **UI 呈现**:申请详情页显示其关联的 networking 时间线;联系人详情页显示其关联的所有申请

## 8. 泛化设计(Phase B 地基)

- 一切"用户是谁"的信息住 **`profile/` 目录 + profile 表**:个人资料、签证状况、目标方向与梯队、简历库、剧本语气偏好、每日时间预算、申请表标准答案
- 代码零硬编码个人信息;换用户 = 换 profile
- Phase B 只需追加:新用户引导问卷、多用户部署、推广物料(单独立项)

### 8.1 LLM 适配层(用户要求:Phase B 免重构的关键)
判断引擎的每个任务(匹配打分、简历生成、草稿撰写)定义为**与模型无关的契约**:输入 prompt 模板 + 输出 JSON schema。契约之下是可插拔的 backend 适配器:

| Backend | 适用人群 | 说明 |
|---|---|---|
| Claude Code / Agent SDK(订阅) | 本用户默认 | 走用户已有的 Claude 订阅,无额外 API 费 |
| 其他 agent CLI 订阅(Codex、Kimi CLI 等) | Phase B 用户 | 适配器调对应 CLI 的无头模式 |
| 直连 API(Anthropic / OpenAI 兼容 / Kimi 等) | Phase B 用户 | 用户填自己的 API key,OpenAI 兼容格式覆盖大部分厂商 |

- 所有判断任务只依赖契约接口,不依赖具体 backend;新增模型 = 新增一个适配器文件
- **执行引擎(浏览器填表)例外声明**:驱动真实浏览器需要 agent 能力,并非所有 backend 都支持;适配层为其定义能力探测接口,不支持的 backend 降级为"只准备不代填"

## 9. 通知与日常节奏

- **自动流水线**:早晨扫描 → 去重入库 → Claude 匹配打分+选简历 → 生成申请队列 + networking 草稿 → 推送"今日 N 个申请已备好、M 条草稿待审"
- **通知双通道**:macOS 系统通知 + ntfy 手机推送;默认每天一次汇总
- **黄金机会即时警报**(用户确认开启,阈值严):T1 梯队公司 + 匹配分 ≥85 的新岗,发现即单独推送,抢首批申请窗口;预期每周仅数次
- **队列常驻**:准备好即推送,用户任意时间接手;无固定 session 时间
- **队列管理**(用户明确否决自动归档):不做"挂 N 天自动清理";队列规模靠可调匹配阈值控制,不想投的由用户在 UI 手动归档
- 用户日操作全景:打开 UI → 看 Dashboard → 过确认队列(点确认)→ 审 networking 草稿(点发送)→ 关掉走人,全程 ≤1–2h

## 10. Dashboard

漏斗(投递→OA→面试→offer)、分方向/梯队投递量与转化、回复率、networking 独立漏斗(发出→回复→约上→产出)、**交叉统计(带 referral vs 海投转化对比、各剧本产出、经 networking 发现的岗位占比)**、每日/周趋势、待办提醒(该 follow-up 的人、OA 截止日、T3 检查清单)。

**周报视图**(用户确认:不做周日推送仪式,改为 Dashboard 常驻):Dashboard 内置"本周总览"页,近实时展示本周投递/回复/networking 产出、与上周对比、策略建议(哪个方向转化好该加仓、哪些 watchlist 公司两周零产出可考虑调整),用户任意时间查看。

## 11. 可靠性、安全与错误处理

### 11.1 可靠性
- 源级隔离:单源失败不阻塞流水线,UI 红点提示错误
- SQLite WAL 模式 + 每日自动备份(本地滚动 7 份)
- 填表遇到未知表单结构 → 标记"需人工",不猜不瞎填
- LinkedIn 自动化保守节流(随机间隔、只在用户接手时段操作真实浏览器),避免风控
- 永不越过提交/发送红线(§6、§7.1)

### 11.2 安全(为产品化从第一天设计)
- **本地优先**:所有个人数据只存本机;对外流量仅限 Claude API 调用与职位源抓取,个人数据永不进 URL 参数
- **不碰凭据**:系统不存储、不读取任何密码;登录态完全留在用户自己的 Chrome 里;API key 存 `.env`(git 排除)或 macOS Keychain
- **服务只绑 localhost**;API 层预留 token 鉴权接口(Phase B 多用户的地基)
- **Prompt 注入防护**:抓来的 JD 全文、LinkedIn 帖子、他人消息一律视为不可信数据——判断引擎的 prompt 明确隔离"数据"与"指令",绝不执行页面/JD 里出现的指示;执行引擎的提交红线在代码层,不受 LLM 输出影响
- **依赖与输入卫生**:参数化 SQL(无字符串拼接)、依赖锁定与定期 audit、上传/导入文件只做解析不执行
- **Phase B 预留**:多租户数据隔离、静态加密、数据导出/删除接口,设计时留位、届时实现

## 12. 测试策略

- 扫描器/去重/签证过滤:单元测试 + 录制的 API fixture
- 匹配 prompt:固定 JD 样本集回归(方向分类与梯队不漂移)
- 申请执行:dry-run 模式(测试表单页走全流程但不提交)
- UI:核心流(确认队列、CRM、设置)e2e smoke
- 通知:每通道一条测试推送

## 13. 建设顺序(用户确认:骨架一次搭全,networking 与投递同等优先)

1. App 骨架:Next.js + SQLite + 数据模型 + profile 目录
2. 扫描引擎(T1 全自动源)+ watchlist 初始生成
3. 匹配引擎 + Resume Studio 简历引擎(含现有材料导入与补充问答)
4. 申请执行引擎 + 确认队列 UI
5. Networking 引擎 + CRM UI
6. Dashboard + 通知 + 调度收尾
7. (单独立项)Phase B 泛化与推广
