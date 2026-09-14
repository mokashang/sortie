# 账号与多租户(accounts)设计 — 2026-09-13

## 目标
用户要求:「最专业的成熟产品级别的账号登录功能」——可以用 Google 等第三方账号登录,也可以用邮箱自己创建账号;**每个账号的数据彼此分开**。这是 Phase B(泛化成多用户产品)的地基:在此之前 Sortie 是一个人的系统,库里没有租户列,档案是手改的 `profile/profile.yaml`,执行器和调度器裸调 API。

## 事实与约束
- 产品仍是自托管:一台 Windows 常开机,Caddy 反代到 127.0.0.1:3000,只在 tailnet 可达(usesortie.com / ts.net / 本机 127.0.0.1)。
- 岗位是**公共数据**(扫描全网得到),匹配打分、投递、人脉、简历、经历、档案是**每个人自己的**。
- 值守会话(Claude 桌面 App / 调度器拉起的 CLI)与 headless 执行器都用 `curl` 调 App API;它们以后必须带凭证,且只能碰自己那个用户的数据。
- 现有 752 个测试用裸 SQL 造数据;迁移不能把它们全改一遍。
- 2026-09-03 用户红线不变:提交/发送必须经 App 确认、不虚构、不碰密码。

## 设计

### 1. 认证层:Better Auth
- 库 `better-auth`(1.7),直接接 better-sqlite3 句柄(同一个 `data/jobseeker.db`,Kysely sqlite 方言)。表 `user` / `session` / `account` / `verification` 由 `schema.sql` 建(列名沿用 Better Auth 默认 camelCase,类型按其 sqlite 映射:string→TEXT、boolean→INTEGER、date→DATE),`user` 多一列 `role`(`owner` | `member`)。
- 方式:**邮箱 + 密码**(scrypt;最短 8 位;邮箱验证 + 找回密码走邮件)+ **Google**(`.env` 有 `GOOGLE_CLIENT_ID/SECRET` 才显示按钮;回调 `<BETTER_AUTH_URL>/api/auth/callback/google`;同邮箱自动关联)。
- 会话:httpOnly cookie,30 天,cookie 缓存 5 分钟(首页每 5 秒轮询不打库);`trustedOrigins` = usesortie.com、ts.net、127.0.0.1:3000、localhost:3000。生产下 Better Auth 自带限流。
- 邮件:`src/lib/mailer.ts`。配了 `SMTP_URL`(如 `smtps://user:pass@smtp.gmail.com:465`)+ `MAIL_FROM` 就用 nodemailer 真发;没配就把邮件写到 `data/outbox/*.txt` 并打日志(自托管一个人用时照样能完成验证/重置)。**配了 SMTP 才强制邮箱验证**,否则验证是可选的(设置页有「重发验证邮件」)。
- 账号页(设置 → 账号):名字、邮箱(改邮箱要验证)、改密码 / 设密码(Google 用户)、已登录设备(踢掉其他设备)、已关联登录方式、**助手令牌**、删除账号(删所有本人数据)。
- 路由保护:`src/middleware.ts` 只看有没有会话 cookie(便宜):页面没 cookie → 跳 `/login?next=`;API 没 cookie 也没 Bearer → 401。真正的校验在每个 handler / 页面里(`requireUser`)。登录、注册、忘记密码、重置密码、验证邮件页在 `(auth)` 路由组,没有侧栏;应用页在 `(app)` 路由组,布局里统一校验会话。

### 2. 三种主体(actor)
每个请求解析成一个 actor,所有租户数据都按 `actor.userId` 过滤:
1. **浏览器会话**(cookie)→ 该用户。
2. **个人令牌**(`Authorization: Bearer sortie_…`,设置页生成,库里只存 sha256)→ 该用户。给用户自己电脑上的值守会话 / 脚本用。
3. **内部令牌**(`data/internal-token`,首次启动自动生成,或 `SORTIE_INTERNAL_TOKEN`)→ **视为 owner**(这台机器的主人)。调度器 tick、dispatcher、部署脚本、常开机上的桌面值守会话都用它;它对租户接口的语义是「以 owner 身份」。
每个 run 另有一枚**运行令牌**(`api_tokens.kind='run'`,绑定 run 与用户,24h 过期,finish 时作废):headless `claude -p` 与调度器拉起的 CLI 会话通过提示词拿到它,所以它们只能动自己那个用户、自己那个 run 的东西。

### 3. 租户模型(schema v16;原定 v15,main 在 2026-09-13 先用 v15 加了 applications.run_id / executor_runs.outcome)
- **公共**:`jobs`、`boards`、`companies`、`events`(加可空 `user_id`)、`profile` kv(机器状态:心跳/子进程记录,按用户加后缀)。
- **每个人的**(加 `user_id TEXT NOT NULL DEFAULT 'legacy'`):`matches`(UNIQUE(user_id, job_id))、`applications`(UNIQUE(user_id, job_id))、`people`(UNIQUE(user_id, linkedin_url))、`outreach`、`resumes`(UNIQUE(user_id, version_name))、`experiences`、`executor_runs`。新表 `profiles`(user_id PK, data JSON)、`api_tokens`。
- `'legacy'` 是**迁移前数据的桶**:第一个注册的账号(或 `.env` 指定的 `SORTIE_OWNER_EMAIL`)成为 owner,认领整个桶(UPDATE user_id),并把 `profile/profile.yaml` 导进 `profiles`。之后 `profile.yaml` 不再被读(档案页有完整编辑器;也可在档案页「从 profile.yaml 导入」)。DEFAULT 只为迁移与测试造数据存在:应用代码**永远显式写 user_id**,`tests/tenancy-guard.test.ts` 静态扫描 `src/` 里的 INSERT 保证这一点。
- **每个岗位、每个用户一行 `applications`**(和现在「每个岗位一行」的不变量一致,所有 JOIN 只需加 `a.user_id = ?`):新用户注册时回填全部岗位(discovered),扫描入库时给每个用户各插一行。匹配、队列、投递、历史、统计都按用户。`matches` 的 JOIN 一律带 `m.user_id = a.user_id`。
- 岗位级事实(签证/学历/岗位类型/重复簇)仍是公共的:去重整合与 jd_review 归档整簇时作用于所有用户的行(同现在)。
- 简历 PDF 写到 `data/users/<userId>/resumes/`;老路径继续有效。headless 浏览器档案按用户:`data/users/<userId>/browser-profile`(owner 沿用老的 `data/browser-profile`)。

### 4. 后台流水线按用户
- 扫描仍是全局一条。入库后的接力(`startPostScanPipeline`):去重(全局)→ **对每个档案完整的用户**跑匹配(本小时全局打分额度按人平分)→ 内推建议 → 升级板块 → jd_review 接力(以 owner 身份起 headless run)。
- 新用户只打分**其注册前 45 天以内**入库的岗(`users.createdAt − 45d`);老岗位大多已关闭,不值得烧额度。
- referral_check 每天两次的自动入队:对每个有待查内推的用户各入一个。调度器只为 **owner** 的排队 run 拉起 CLI 会话(这台机器的 Chrome 是 owner 的);其他用户在自己电脑上开值守会话(带个人令牌)。

### 5. 值守 / 执行协议的变化(CLAUDE.md §3)
- 每个 `curl` 加 `-H "authorization: Bearer $TOKEN"`:常开机上的桌面会话 `TOKEN=$(cat data/internal-token)`;调度器拉起的 CLI 与 headless 会话由提示词给出运行令牌;别的用户用个人令牌。
- claim-next 只返回**该用户**的排队 run;`/api/apply/*`、`/api/referral/*`、`/api/network/*`、`/api/executor/*` 全部按 actor 用户作用。接口路径、body 形状不变。
- 心跳按用户记录;dispatcher 只看 owner 的心跳与排队。

### 6. 前端
- `/login`(邮箱密码 + Google)、`/signup`、`/forgot-password`、`/reset-password`、`/verify-email`;设计语言同「制版间」。
- (2026-09-14 补)`/privacy`、`/terms`:无需登录的公开文档页,独立的 `(public)` 路由组(品牌 + 一栏正文 + 页脚的另一份文档 / 回到 Sortie / 语言切换),文案在 `src/i18n/messages/legal.ts`;Google 登录的品牌塑造页链接到它们,登录卡下方也有链接。
- 顶栏右侧头像菜单(名字 / 邮箱;手机在「更多」弹层里)→ 账号与设置 / 我的档案 / 退出登录。(2026-09-13 合入「Dispatch」顶栏壳后从侧栏底部移到这里)
- 档案页新增「基本信息」标签:姓名、邮箱、电话、LinkedIn、GitHub、学校、学位、毕业年月、工作授权、目标岗位类型、12 个方向的梯队、EEO;档案不完整时首页顶部提示「先完善档案,助手才能开始匹配」。
- 设置页新增「账号」区(见 §1)。

### 7. 不做
- 不做团队/组织、不做管理员后台、不做邀请制(可用 `SIGNUP_DISABLED=1` 关闭注册)。
- 不给每个用户单独的扫描源;不做每用户的签证规则(`QUEUE_ELIGIBLE_SQL` 仍按 F-1 的硬规则)。
- 不改 LLM 后端:`claude -p` 仍是机器级订阅。

## 验收
- 单测:v15 → v16 迁移(表重建、唯一约束、legacy 桶)、认领、回填、每个模块按用户隔离(两个用户互相看不见)、actor 解析(cookie / 令牌 / 内部令牌)、租户静态检查。
- 真机:注册第一个账号 → 认领旧数据(队列、历史、人脉都还在)→ 第二个账号看到空数据 → Google 登录(配好 client 后)→ 助手令牌能过 claim-next。
