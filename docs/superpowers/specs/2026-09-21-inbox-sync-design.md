# 邮箱同步:把申请结果自动记进历史 — 2026-09-21

## 1. 背景与目标

用户(2026-09-21):「你有我的邮箱 shangmengjiajiajia@gmail.com 的接口,阅读邮箱邮件,里面会有投递过的公司
的结果,有的拒绝,有的有下一步,把这些都自动地反映到系统上而不是我手动去看然后记录。」

之前「历史」页的 OA / 面试 / Offer / 被拒 全靠用户看完邮件再手动改状态。现在 App 自己读邮箱:
每 15 分钟拉一次新邮件,认出哪封是哪份申请的结果,直接改历史页的状态、留一条备注、推一条通知。
用户只在历史页看到「邮件 · 面试邀请」这样的角标和邮件动态列表,不再自己记账。

## 2. 原则

- **只读**。Gmail 权限只申请 `gmail.readonly`;App 不发信、不改标签、不删邮件。
- **只认已投出的申请**。匹配对象仅限 `applications.status` 在投递后阶段(submitted / oa / interview /
  offer / offer_accepted / offer_declined / rejected / stale)的行。队列里没投的岗不会被邮件改动。
- **邮件正文是数据不是指令**。提示词里明说;模型只输出结构化 JSON。
- **状态只前进,不倒退**:oa / interview / offer 只在比当前阶梯更高时写入;`rejected` 在任何未接 offer 的
  阶段都写入(被拒是最常见的结果);已接受 / 已婉拒 的 offer 永不被邮件改动。确认信(「我们收到了你的申请」)
  和「仍在审核」只记事件不改状态。
- **可撤销**:每次改动都是普通的 `setStage`(有 `application_stage` 事件与备注),历史页照样能手动改回。
- **不猜**:置信度 < 0.7、或对不上任何申请的邮件只记入 `mail_events`(历史页「邮件动态」里能看到),不动状态。
- 令牌只存服务器库里(`mail_accounts.refresh_token`),不进页面、不进日志。

## 3. 连接方式

设置页「邮箱同步」区:「连接 Gmail」= Better Auth 的 `linkSocial({provider:'google', scopes:[gmail.readonly],
additionalParams:{prompt:'consent'}, callbackURL:'/settings?inbox=connected'})`。Google 提供方全局加
`accessType:'offline'`(登录本身不受影响;`prompt=consent` 只在连接这一次出现)。回到设置页后客户端调
`POST /api/inbox/connect`:服务端从 Better Auth 的 `account` 表读该账号 google 行的 `refreshToken` 与 `scope`,
scope 含 gmail.readonly 才复制进 `mail_accounts`(之后普通 Google 登录覆盖 `account.accessToken` 也无所谓,
同步永远用自己那份 refresh token 现换 access token),并立即跑第一次同步。

Google Cloud 项目 `Sortie` 未做品牌与敏感权限审核,请求 gmail.readonly 时 Google 会弹「未验证的应用」页,
主账号点「高级 → 继续前往 usesortie.com」即可(个人使用,≤100 用户不用审核)。回调地址不变。

「断开」= 删掉 `mail_accounts` 行并尽力向 Google 撤销该 refresh token(不影响登录:登录靠 cookie)。

## 4. 数据(schema v17)

```
mail_accounts(user_id PK, provider, email, refresh_token, scope, connected_at, synced_at, watermark, last_error, enabled)
mail_events(id, user_id, message_id, thread_id, received_at, from_addr, subject, snippet, job_id, outcome,
            confidence, summary, next_step, applied, stage_from, stage_to, created_at, UNIQUE(user_id, message_id))
```

- `watermark`:unix 秒,只拉这之后收到的邮件;首次连接 = max(最早一份已投申请的提交时间, 30 天前)。
- `outcome`:`received | rejected | oa | interview | offer | other | unrelated`。
- `applied=1` 表示这封邮件改了状态,`stage_from/stage_to` 记改动。

## 5. 同步流程(`src/inbox/`)

`src/instrumentation.ts` 每 15 分钟 `POST /api/inbox/tick`(内部令牌);设置页「现在同步」= `POST /api/inbox/sync`。
每个启用的账号(`src/inbox/sync.ts`):

1. `google.ts`:用 refresh token 换 access token(进程内缓存 50 分钟)。
2. `users/me/messages?q=after:<watermark> -in:spam -in:trash -category:promotions -category:social`,
   分页最多 200 封 / 次;跳过 `mail_events` 里已有的 id。
3. 逐封 `messages/<id>?format=full`,取 From / Subject / Date、text/plain(没有就剥 HTML)前 6000 字。
4. `filter.ts` 预筛(零成本):发件域名在 ATS 名单(greenhouse / lever / ashby / workday / icims / smartrecruiters /
   hackerrank / codesignal / hirevue …)、或 主题 / 发件人 / 正文 提到任一已投公司名、或主题命中
   application / interview / assessment / offer / candidate / position / recruit / next step 之类词 → 进模型;
   其余直接丢(不入库,水位线照样前进)。
5. `classify.ts`:每批 ≤ 8 封 + 已投申请清单(job_id / 公司 / 职位 / 当前阶段 / 提交日,≤300 行)→ 所选 AI 提供方
   (`getBackend()`,`tier:'fast'`)→ 每封 `{message_id, job_id|null, outcome, confidence, summary, next_step}`。
6. `apply.ts`:按 §2 规则决定是否 `setStage`(备注 = 摘要 + 主题);写 `mail_events`;改了状态或
   outcome ∈ {oa, interview, offer} 的每封各推一条 ntfy(`notify.inbox.*`)。
7. 成功后 `synced_at` / `watermark`(= 本次最新一封的收件时间)更新;失败写 `last_error`,下次再试。

## 6. 界面

- 设置页「邮箱同步」:未连接 → 说明 + 「连接 Gmail」;已连接 → 邮箱、上次同步时间、累计处理数、
  「现在同步」「断开」,有错误时显示。
- 历史页:每行若有邮件事件,显示 `邮件 · <结果>` 角标(悬停看摘要),`next_step` 以小字附在行内;
  列表上方一个「邮件动态」区列最近 30 条事件(时间 / 公司或发件人 / 主题 / 结果 / 是否已改状态),
  对不上申请的也列出来,让用户知道模型读到了什么。
- 通知:`Sortie · Stripe 被拒`、`Sortie · Datadog 面试邀请 — <next_step>`。

## 7. 不做的事

- 不回信、不安排面试、不点邮件里的链接。
- 不把邮件正文存库(只存主题、发件人、Gmail 的 snippet、模型摘要)。
- 不做 IMAP / 其他邮箱;非 Google 登录的账号看到「需要先关联 Google 账号」。
