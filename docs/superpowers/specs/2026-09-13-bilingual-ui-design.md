# 中英文双语界面(2026-09-13)

用户要求:系统有中文、英文两个版本,可以选择切换。中文是原版、仍是默认;英文是每个页面、每条通知、每条 API 报错的完整第二版。本文既是设计说明,也是**改代码时必须遵守的约定**(§3)。

## 1. 用户看到什么

- 顶栏(桌面)多一个「语言」按钮:图标 + 当前语言自己的名字(`中文` / `English`),点一下切到另一种。手机端在「更多」弹层里有同样一行。
- 设置页多一节「语言」分段控件(中文 / English),和「外观」并列。切换后 toast 用**切到的那种语言**说「已切换到中文 / Switched to English」。
- 切换立刻生效:客户端组件经 context 重渲染,服务端组件经 `router.refresh()` 重渲染;刷新页面、换标签页、下次打开都保持;`<html lang>` 同步变。
- 通知(ntfy / 桌面)跟随最近一次选择;API 报错(toast 里的文字)按请求的语言。
- 助手写进任务日志的每一行、它写的草稿、职位标题和 JD 本身**不翻译**(那是数据,不是界面)。12 个方向的名字本来就是英文,两种语言下一样。

## 2. 机制

- 语言值 `Lang = "zh" | "en"`(`src/i18n/lang.ts`),默认 `zh`。
- **cookie `sortie.lang`**(一年,Lax)是每个请求的语言来源:根布局 `getLang()` 读 cookie → `<html lang>` + `LangProvider initial`,所以首屏就是对的语言,不闪。没 cookie 时退到 `<DATA_DIR>/prefs.json` 里保存的语言(`src/lib/prefs.ts`),再没有就 `zh`。
- 切换:`useSetLang()` 先在客户端写 cookie + 改 `document.documentElement.lang`,再 `POST /api/settings/lang {lang}`(服务端也 Set-Cookie、并写 prefs.json 给后台通知用),最后 `router.refresh()`。
- 文案树 `src/i18n/messages/`:一个命名空间一个文件,**同一文件里 `zh` / `en` 并排**,用 `defineMessages({ zh, en })` 定义——TypeScript 从 zh 推断形状、校验 en,少一个键、多一个键、类型不同都编译不过。值可以是字符串,也可以是函数(带数量、名字、日期的句子;英文单复数在函数里处理)。`index.ts` 把所有命名空间拼成 `messages[lang]`,类型 `Messages`。两种语言都打进客户端包(很小),切换不用请求。
- 客户端:`const m = useMessages()`(`@/i18n/client`)、`useLang()`、`useSetLang()`。服务端组件 / route handler:`const m = await getMessages()`、`await getLang()`、`langFromRequest(req)`、`messagesFor(lang)`(`@/i18n/server`)。后台代码(通知):`serverLang()`(`@/lib/prefs`)。
- 页面标题:`export const metadata = { title: "…" }` 改为 `export async function generateMetadata() { return { title: (await getMessages()).nav.xxx }; }`。
- 测试 `tests/i18n.test.ts`:① zh / en 键与值类型完全一致;② 英文值不含中文;③ **`src/app/**` 及 `src/apply/{stages,funnel,info}.ts`、`src/executor/runner.ts` 的非注释代码里不允许出现中文**(白名单只有 `queue-const.ts` 的路由哨兵 `未分类` 和 `log-steps.ts` 的关键词正则)。任何写死的中文都会让这条测试失败,这就是「英文版是完整的」的定义。

## 3. 改代码的约定(逐条遵守)

1. **所有用户可见文字都从 `m` 取**,包括 aria-label、title、placeholder、toast 标题/描述、空态、Tooltip、`<option>`、按钮文字、Section 的 title/description、Stat 的 label/hint、PageHeader 的 subtitle/kicker、确认对话框的文字。注释可以是任何语言。
2. 命名空间按页面:`today` / `queue` / `apply` / `history` / `network` / `profile` / `dashboard` / `sources` / `settings`,组件用 `assistant` / `palette` / `scan` / `ui` / `shell`,共享的用 `common`(取消 / 确认 / 关闭 / 保存 / 撤销 / 全部 / 更多 / 暂无数据 …)、`labels`(枚举显示名:run 状态、任务种类、通道、经历种类、签证 / 学历 / 岗位类型、outreach 状态、内推阶段、关系、剧本、渠道、`tier(n)`、`unclassified`、`mode`)、`time` / `rank` / `runs` / `stages` / `answers` / `errors` / `notify`。**只在自己页面的命名空间里加键;不要改别人的文件**(需要共享词先看 `common` / `labels` 有没有)。
3. 键名 camelCase,按组件分组(`m.apply.plan.title`、`m.apply.confirm.approve`)。一句话一个键,不要把句子拆成碎片拼接——英文语序不同。有数量就用函数并处理单复数:`count: (n: number) => (n === 1 ? "1 job" : \`${n} jobs\`)`。
4. 枚举显示名:`labelOf(m.labels.runStatus, status)`;方向:`directionName(slug, lang)`(`@/app/lib/labels`,null / `未分类` 哨兵 → 未分类 / Unclassified),不要再写 `x ? directionLabel(x) : "未分类"`;梯队 `tierLabel(tier, lang)`;模式 `modeLabel(mode, fit, lang)`;时间 `relativeTime(ts, lang)` / `relativeDays(iso, lang)` / `formatDate(d, lang)`;扣分说明 `timePenaltyNote(age, big, lang)`;任务描述 `describeRun(kind, options, lang)`;标准答案 `answerLabel(key, lang)` / `answerHint(key, lang)`;投递阶段 `stageLabels(lang)` / `stageLabel(stage, lang)`;漏斗 `buildFunnel(rows, lang)`。这些纯函数都要显式传 `lang`(客户端 `useLang()`,服务端 `await getLang()`)。
5. 服务端组件(`page.tsx` 没有 `"use client"`)用 `await getMessages()`,并把 `metadata` 改成 `generateMetadata`;把语言相关的字符串算好再传给客户端组件也可以,但客户端组件自己 `useMessages()` 更省事。
6. 英文文案风格:产品语气,简短,句首大写、其余小写(sentence case),不用感叹号,不用内部词(run / executor / headless / user_chrome / slug / pid)。术语表:今日 Today · 职位 Jobs · 投递 Apply · 历史 History · 人脉 Network · 档案 Profile · 统计 Stats · 设置 Settings · 信息源 Sources · 助手 assistant · 任务 #N task #N · 在我的 Chrome 里 in my Chrome · 后台浏览器 background browser · 内推 referral · 海投 direct apply(模式名 Direct)· 找内推 find a referral · 建议内推 referral suggested · 有内推了 Got a referral · 待确认 Awaiting your confirmation(节标题 To confirm)· 待补信息 Needs info · 需人工 Needs manual handling(节标题 Manual)· 今日已提交 Submitted today · 内推进行中 Referrals in progress · 方向 track · 梯队 tier · 队列 queue · 全部入库 All jobs · 入库可见 Visible · 已打分 Scored · 可投 Ready to apply · 已隐藏 Hidden · 置顶 pin · 跳过 skip · 归档 archive · 撤销 undo · 补正文 fetch descriptions · 打分 score · 补判 re-check · 校友 alum · 招聘方 recruiter · 用人经理 hiring manager · 工程师 engineer · 请教 / coffee chat coffee chat · 经历 experience · 简历 resume · 标准答案 standard answers · 板块 board · 家族 family · 核心 / 长尾 / 休眠 / 静音 core / longtail / dormant / muted · 签证 sponsorship · 仅限博士 PhD only · 确认提交 Confirm and submit · 拒绝 Reject · 批准 Approve · 退回草稿 Back to draft · 作废 Discard.
7. 不要动执行器提示词(`src/executor/prompts.ts`)、扫描器、匹配器里的中文——那是给模型的指令或注释,不是界面。
8. 验证:`npx tsc --noEmit -p .`(只看自己文件的错误)和 `npx vitest run tests/i18n.test.ts`(看输出里自己目录的行是否清零),最后 `npm test` 全绿。

## 4. 文件

- `src/i18n/lang.ts`(常量、cookie 名、解析)· `define.ts`(`defineMessages`)· `client.tsx`(`LangProvider` / `useLang` / `useSetLang` / `useMessages`)· `server.ts`(`getLang` / `getMessages` / `langFromRequest` / `messagesFor`)· `messages/*.ts` + `index.ts`。
- `src/lib/prefs.ts`(`prefs.json`)· `src/app/api/settings/lang/route.ts`。
- 改过签名的共享库:`src/app/lib/{labels,time,time-penalty,describe-run,answer-labels}.ts`、`src/apply/{stages,funnel,info}.ts`、`src/executor/runner.ts`(`ExecutorStartError` 带 code,route 按语言出文案)。
- 壳:`layout.tsx`(读 cookie、`generateMetadata`)、`providers.tsx`(`LangProvider` 最外层)、`shell/nav.ts`(`key` 代替 `label`)、`shell/app-shell.tsx`(语言按钮)、`settings/settings-client.tsx`(语言分段控件)。
