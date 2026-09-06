# Sortie 前端「市场级」重做 — 设计文档(2026-09-06)

> 本文档由自主会话在用户设定目标(`/goal`:把前端做到真正面向市场用户的水准)后撰写。
> 用户不在线,所以每个决定都由本会话拍板并在此记录,标 **[决定]** 的地方都可以被用户推翻。
> 后端(扫描、匹配、执行器协议、数据库)视为已定,本次只动前端;仅允许的后端改动列在 §7。

## 0. 一句话

把现在「功能齐全但像内部工具」的 8 个页面,重做成一个有清晰信息架构、成熟设计系统、产品级文案、完整状态处理(加载/空/错误/撤销)、能在手机上用的求职助手产品——**保留用户选定的「制版间 / Editorial Paper」气质**,把它从「一版 CSS」升级成「一套设计系统」。

## 1. 现状诊断(为什么现在不是市场级)

对照 2026-09-06 的截图与全部页面源码(`src/app/**`,约 4100 行 TSX + 451 行 CSS):

| # | 问题 | 例子 |
|---|------|------|
| 1 | **说明书式文案**:每页顶部一段 3–5 行的系统原理说明 | /apply 顶部 4 行讲值守会话如何接手;/queue 讲 tab 与排序规则 |
| 2 | **内部术语泄漏到界面** | `run #24`、`pid`、`值守会话`、`claude-in-chrome 扩展的交互式 Claude Code 会话`、`user_chrome`、`swe_general`、`(high_school)`、`profile.yaml`、`sqlite`、`__all__`、Studio 下拉里的英文 slug、Profile 的 `education/work/project` |
| 3 | **中英混杂的导航与标题** | 导航「职位 投递 历史 人脉 Profile Studio」;标题「Dashboard」「Resume Studio」「Networking 漏斗」「Outreach 历史」 |
| 4 | **没有首页**:`/` 直接跳统计页;用户收到手机通知后打开 App,找不到「现在要我做什么」 | 待确认在 /apply 中部、待补信息在 /apply 顶部、内推草稿在 /apply 底部、coffee chat 草稿在 /network |
| 5 | **原生 `prompt/confirm/alert` + `location.reload()`** | 拒绝原因、历史状态备注、移除需人工、重试、扫描完成后整页刷新 |
| 6 | **表格万能**:每行 5 个 11px 幽灵按钮(申请/展开/置顶/改为找内推/跳过),JD 用 `<pre>` 倒出 | /queue |
| 7 | **主要操作被埋没**:/apply 的「开始投递」在 12 行配额表最底下;通道选择(值守 / 无人值守)带两段说明常驻页面顶部 | /apply |
| 8 | **零响应式**:固定 1100px、表格横向溢出、手机上不可用 | 全部 |
| 9 | **没有加载/空态/错误/撤销的统一处理** | 「加载中…」纯文本、错误红字、跳过撤销条是唯一的撤销 |
| 10 | **Profile 只能增删不能改**;简历页无预览;标准答案是键值表 | /profile、/studio |
| 11 | 视觉细节:`var(--paper, #fff)` 未定义变量、固定定位的「有内推了」弹层、图标缺失、按钮尺寸不一 | referral-panel |

好的部分要保留:制版间的纸/墨/印刷红三色、Newsreader + IBM Plex Sans + JetBrains Mono、直角、细线、顶墨线面板、深色「墨纸」;所有页面都已有可用的数据接口;客户端轮询模式(3–5s)简单可靠。

## 2. 目标与验收标准

**目标用户**:一个每天打开 Sortie 1–2 次的求职者。典型一天:手机收到「3 份申请待确认」→ 打开 App → 首页看到卡片 → 逐张核对点确认 → 顺手看一眼队列前排、批准两条内推留言 → 关掉。

验收(全部满足才算「市场级」):

1. **信息架构**:首页即收件箱;导航 ≤ 7 项、全中文、每项一个图标;任何一次「需要用户决定」的事情从首页一步可达。
2. **设计系统**:所有颜色/间距/字号/圆角/阴影来自 tokens;有一套可复用组件(按钮、标签、卡片、统计块、表单域、标签页、分段控件、对话框、抽屉、通知、骨架屏、空态、菜单、工具提示);光/暗两套完整并可手动切换。
3. **文案**:界面上不出现 §5 术语表左列的任何词;说明文字 ≤ 1 行,更多解释放进工具提示或「了解更多」折叠;所有 slug/枚举经标签映射显示。
4. **交互**:没有 `window.prompt/confirm/alert`,没有 `location.reload()`;破坏性操作要么可撤销(通知条),要么先经对话框确认;所有异步操作有加载态、失败提示。
5. **响应式**:375px 宽下每页可完成核心操作(确认申请、批准留言、翻队列、改历史状态);≥ 1280px 有侧边导航。
6. **可达性**:键盘可完成确认/批准;焦点可见;对话框/抽屉锁焦点、Esc 关闭;图标按钮有 `aria-label`;对比度 ≥ 4.5:1。
7. **工程**:`npm run build` 无错误无警告(lint + 类型);`npm test` 全绿并新增前端纯逻辑测试;每页有 `loading.tsx`;根有 `error.tsx`/`not-found.tsx`;有站点图标与标题模板。
8. **文档**:CLAUDE.md、README 中提到的界面位置(「/apply 待补信息卡片」等)全部更新到新位置;协议(API)不变。

## 3. 信息架构 [决定]

```
侧边导航(桌面)/ 顶栏 + 抽屉(手机)
├─ 今日        /            收件箱:需要你处理的事 + 助手状态 + 关键数字 + 快捷操作
├─ 职位        /queue       职位队列(主舞台):列表 + 右侧详情抽屉
├─ 投递        /apply       发起投递 + 助手进度 + 待确认 / 待补信息 / 内推进行中 / 需人工 / 今日已提交
├─ 历史        /history     已提交申请的追踪(状态、漏斗)
├─ 人脉        /network     联系人 + coffee chat 草稿 + 已批准待发
├─ 档案        /profile     经历 | 简历 | 标准答案(三个标签页;/studio 重定向到简历标签)
├─ 统计        /dashboard   漏斗、分方向、内推 vs 海投、本周对比
└─ 设置        /settings    执行方式(值守/无人值守)、外观、通知、信息源入口(→ /sources 高级页)
```

- `/`:不再重定向到 /dashboard。新「今日」页。
- `/jobs`、`/studio`:保留重定向(旧书签)。
- `/sources`:仍不在导航,但从设置页「信息源(高级)」可达;用新组件重排,不改功能。
- 侧边栏底部:助手状态胶囊(空闲 / 排队中 / 进行中 / 需要你,点击去 /apply)、主题切换、设置。
- 「投递」导航项带实时角标 = 待确认 + 待补信息 + 内推草稿待批 的总数;「人脉」角标 = coffee chat 草稿待批数。

### 3.1 今日(首页)

自上而下:
1. **问候行**:「9 月 6 日 · 周日」+ 一句状态(「有 3 件事等你决定」/「今天没有需要你决定的事」)。
2. **助手状态卡**(共享组件 `AssistantCard`):状态、当前任务一句话(来自 `describeOptions`)、最近一步(日志尾行)、已运行时长、[查看步骤][停止];空闲时显示「上次:…」与 [开始投递]。
3. **需要你处理**:按紧急程度排列的卡片组——待确认申请(完整确认卡,与 /apply 同一组件)、待补信息(完整表单)、内推留言待批(公司卡,同 /apply)、内推有进展(对方答应/已内推 → 「有内推了」按钮)、coffee chat 草稿待批(摘要 + 去人脉页)。全空时用空态组件。
4. **数字条**:队列可投、今日已提交、本周已提交、内推进行中(4 个 Stat)。
5. **快捷操作**:开始投递(去 /apply 并聚焦计划)、扫描新职位(立即扫描 + Chrome 扫描 合成一个菜单按钮)。

### 3.2 职位

- **页头**:标题「职位」+ 数字条(入库 / 已打分 / 可投 / 已隐藏,带工具提示解释「已隐藏 = 签证不符 + 海外」)+ 右侧「扫描 ▾」菜单按钮(立即扫描 / 在我的 Chrome 里扫描)。
- **工具栏**:方向选择(可横向滚动的胶囊条,每个带数量,末尾「全部入库」;手机上折成下拉)、模式分段控件(全部 / 内推 / 海投)、排序下拉、搜索框(公司/标题,新增后端 `q` 参数,§7)、「补判内推建议」降级为工具栏右侧的次要按钮(仅未判 > 0 时显示)。
- **列表**:不用 `<table>`,用行组件(flex),每行:分数徽章(等宽数字,≥85 深色)、公司(衬线)+ 标题、地点(截断)+ 发布时间(相对)+ 状态小标签(新 / 另有 N 地点 / 无正文 / 登录墙 / 打不开)、模式标签(内推 / 海投 / 手动·)、置顶星、行尾「⋯」菜单(打开申请页 / 置顶 / 改为找内推 / 跟随建议 / 跳过)。点击行 → 详情抽屉。
- **详情抽屉**(右侧 560px,手机全屏):公司/标题/地点/发布/来源链接;匹配块(分数、方向、梯队、简历版本、理由);资格块(sponsorship / 学历 / 岗位性质,只在有值时显示,用中文);内推建议块(建议 + 理由 + 覆盖按钮);JD 正文(按段落渲染,`white-space: pre-line`,可折叠);底部动作条(打开申请页 / 置顶 / 跳过)。抽屉内有「上一条 / 下一条」按钮在当前页内切换;不做键盘快捷键。
- **跳过**:行淡出 + 底部通知条「已跳过 Stripe · SWE New Grad [撤销]」8 秒。
- **分页**:底部,上一页/下一页 + 「第 1 / 64 页 · 1578 条」。
- 「全部入库」tab:同样的行组件,多一列入库时间,行内只有「打开」和「展开」。

### 3.3 投递

- **助手状态卡**(同首页)。
- **本次投递计划**卡:每方向一行:方向名 + 梯队标签,两个步进器(找内推 / 海投)各带「可取 N」;底部粘性汇总行「共 N 份(找内推 a · 海投 b)」+ 主按钮「开始投递」;右上角一行灰字「将在你的 Chrome 里操作 · 更改」链接到设置。进行中时整卡禁用并显示「进行中…」。「补正文」按钮移到卡片右上「更多 ▾」(仍是 headless,带待补数)。
- **待补信息**(有才显示,琥珀色边):同现有表单,字段标签友好化(key 只在工具提示里)。
- **待确认**:卡片(公司/标题/方向/分数/简历版本/带内推标记)+ 字段核对表(两列,长文本可展开)+ [确认提交] [拒绝…](拒绝打开小对话框填原因)。已批准显示「已批准 · 等助手提交」。助手离线时卡顶显示警告条「助手未运行,批准后不会提交 → [开始投递]」。
- **内推进行中**:公司卡:岗位列表(标题链接 + 方向 + 分)、联系人列表(姓名 · 关系 · LinkedIn · 状态标签 · 阶段标签 · 最近一条消息摘要 · 建议)、草稿编辑(完整版 / 留言版 两个文本域 + 字数)、[批准发送][拒绝]、卡级 [全部批准];卡底 [直接投][有内推了…][再撒网][放弃…];「有内推了」和「放弃」用对话框。顶部 [现在检查回复] + 一行灰字说明。
- **需人工**:折叠区 → 改为独立小节,列表行:公司/标题/原因/时间 + [打开][重试][移除];批量勾选移除经确认对话框;移除后本地移除 + 通知条撤销(调用 unarchive)。
- **今日已提交**:紧凑列表,链接到历史。

### 3.4 历史

- 页头数字条(各阶段计数);漏斗图(现有 Sankey,配色走 tokens);方向标签页 + 模式分段。
- 按日分组;每行状态改为**菜单按钮**(当前状态标签 ▾ → 列表),选择后弹「备注(可选)」小对话框 → 提交 → `router.refresh()`;不整页刷新。
- 手机:行变卡片(公司/标题 + 状态按钮 + 时间)。

### 3.5 人脉

- 顶部两张卡:「草稿待批 (N)」「已批准待发 (N)」(邮件的 mailto 按钮 + 标记已发)。
- 主体两栏:左 联系人列表(搜索框、关系筛选、[添加联系人] 对话框);右 联系人详情(基本信息、关联岗位、Outreach 时间线气泡、结果按钮)。手机:列表 → 点进详情(抽屉)。
- 「AI 草稿」改为对话框(选联系人默认当前选中、剧本、渠道)。
- 助手面板:发送已批准 / 找人 两个按钮 + 状态,复用 `AssistantCard` 的紧凑版。

### 3.6 档案

三个标签页(URL `?tab=experiences|resumes|answers`):
- **经历**:按类型分组(教育 / 工作 / 项目 / 技能 / 奖项 / 论文),每条卡片显示标题/机构/时间/bullets,[编辑][删除…];[添加经历] 打开对话框表单(类型、标题、机构、地点、起止、bullets 可增删、每条 bullet 的方向标签多选)。**新增编辑能力**(现在只能增删)。
- **简历**:版本卡片网格(版本名、方向、生成时间、[预览][打开 PDF]);[生成新版本] 对话框(方向下拉显示中文/英文标签、版本名);预览用抽屉内 `<iframe>`。没有经历时空态引导去「经历」。
- **标准答案**:每行 友好标签(已知 key 有映射)+ key 灰色小字 + 输入框 + 删除;下方「常见问题」建议胶囊;[保存]。

### 3.7 统计

保留全部内容,换成新组件:4 个 Stat 卡 + 漏斗条 + 表格(响应式包裹)。「待办」小节移到首页,此处删除。

### 3.8 设置(新)

- **执行方式**:两张可选卡片「在我的 Chrome 里操作(推荐)」/「后台浏览器(无人值守)」,选择存 `localStorage`(`sortie.channel`),投递/人脉发起任务时读取;无人值守卡内有 [打开浏览器档案登录一次]。
- **外观**:浅色 / 深色 / 跟随系统(`localStorage` `sortie.theme`,`<html data-theme>`,首屏内联脚本防闪)。
- **通知**:说明手机推送依赖 `.env` 的 NTFY_TOPIC;显示「已配置 / 未配置」(通过新增只读接口 `GET /api/settings` 返回 `{ntfyConfigured}`,§7)。
- **信息源**:上次检查时间与结果(来自 `/api/sources` 的 lastTick)+ [立即扫描] + [打开信息源高级页]。

## 4. 设计系统 [决定]

### 4.1 Tokens(`src/app/styles/tokens.css`)

- 颜色(浅色):`--bg #f7f4ee`(页面)、`--surface #fdfcf9`(卡片)、`--surface-2 #f0ece2`(内嵌/悬停)、`--ink #171512`、`--ink-2 #3f3a33`、`--sub #6f6a60`、`--line #e2ddd1`、`--line-strong #171512`、`--accent #8a1f11`、`--accent-ink #faf8f4`、`--good #3d6b35`、`--warn #8a6d1f`、`--danger #8a1f11`、`--info #2f4f6f`,以及各自的 `-soft` 底色(如 `--good-soft #e4ecdf`)。深色对应「墨纸」:`--bg #171410`、`--surface #1e1a15`、`--surface-2 #2a241c`、`--ink #ece7dc`、`--sub #98907f`、`--line #353026`、`--accent #c9553e`、`--good #7da36a`、`--warn #c9a94e`、`--info #7fa3c2` 等。
- 间距:`--s-1 4px … --s-8 48px`(4 的倍数)。
- 字号:`--t-xs 11px, --t-sm 12px, --t-base 13.5px, --t-md 15px, --t-lg 18px, --t-xl 24px, --t-2xl 32px`;行高 1.5 / 标题 1.2。
- 圆角:`--r 0`(品牌:直角);阴影:`--shadow-1`(卡片悬停)、`--shadow-2`(抽屉/对话框),深色下更淡。
- 动效:`--ease` `cubic-bezier(.2,.7,.2,1)`,`--dur 160ms`;`prefers-reduced-motion` 归零。
- 布局:`--sidebar-w 224px`,`--content-max 1180px`,断点 `--bp-md 880px`。

### 4.2 组件(`src/app/components/ui/`)

| 组件 | 说明 |
|------|------|
| `Button` | variant `primary / secondary / ghost / danger`,size `sm / md`,`loading`,可带 icon;`IconButton` 需要 `aria-label` |
| `Chip` | tone `neutral / accent / good / warn / danger / info`,可 `outline`;用于方向、模式、状态 |
| `Card` / `Section` | Card = 表面 + 细线;Section = 顶墨线 + 大写小标题(保留制版间面板) |
| `Stat` | 标签 + 衬线大数字 + 可选副文;`StatStrip` 横排 |
| `Field` / `Input` / `Select` / `Textarea` / `Stepper` / `Checkbox` / `Radio` | 统一表单域(标签、提示、错误) |
| `Tabs` | 下划线式,可横向滚动,带计数 |
| `Segmented` | 全部/内推/海投 这类互斥小选择 |
| `Menu` | 「⋯」下拉,键盘可达 |
| `Dialog` | 基于 `<dialog>`,标题/内容/动作区,Esc/backdrop 关闭,锁焦点;`ConfirmDialog` 便捷版 |
| `Drawer` | 右侧抽屉,手机全屏;锁焦点 |
| `Toast` | 全局 `useToast()`,支持 action(撤销),自动消失 |
| `Skeleton` | 行/卡骨架 |
| `EmptyState` | 图标 + 标题 + 说明 + 可选动作 |
| `Tooltip` | 悬停/聚焦提示(`title` 的可样式化替代) |
| `RelativeTime` | 「3 天前」 + `title` 绝对时间 |
| `AssistantCard` | 见 §3.1;`AssistantPill` 侧栏紧凑版 |
| `PageHeader` | 标题 + 副标题(≤1 行)+ 右侧动作 |

图标:`lucide-react`(MIT,按需引入,1.5px 描边与细线风格一致)。

### 4.3 App 壳

`layout.tsx`:`<AppShell>` = 侧边栏(品牌、导航、底部助手胶囊/主题/设置)+ 内容区;`<Providers>` 内含 ToastProvider 与 `OverviewProvider`(每 5s 拉 `GET /api/overview`,提供角标数与助手状态给侧栏、首页、投递页)。手机:顶栏(品牌 + 汉堡 + 助手状态点)+ 滑出导航。

### 4.4 文风

- 标题名词化(「职位」「投递」「今日」);按钮动词化(「开始投递」「确认提交」「批准发送」)。
- 副标题一句话,≤ 40 字;更长的解释进 `Tooltip` 或 `<details>`「怎么用」。
- 数字等宽;时间相对显示,悬停给绝对值。
- 空态要给下一步(「队列是空的 → 扫描新职位」)。

## 5. 术语表(界面禁用词 → 产品词)

| 内部 / 现在 | 界面上 |
|------------|--------|
| 值守会话、执行器、executor、Claude Code 会话 | **助手**(Sortie 助手) |
| run #N / 运行记录 | 任务 #N / 任务记录(N 只在记录表里出现) |
| user_chrome / 用我的 Chrome(值守会话) | 在我的 Chrome 里操作(推荐) |
| headless / 无人值守(专属浏览器档案) | 后台浏览器(无人值守) |
| pid | 不显示 |
| queued / running / done / failed / stopped | 排队中 / 进行中 / 已完成 / 失败 / 已停止 |
| 梯队 N | 梯队 N(保留,用户自己的词) |
| swe_general 等 slug | `directionLabel()` |
| education / work / project / skill / award / publication | 教育 / 工作 / 项目 / 技能 / 奖项 / 论文 |
| high_school 等标准答案 key | 友好标签(映射表),key 作灰色副文 |
| sponsorship yes/no/unknown、ms_ok/phd_only、eng/non_tech | 提供签证 / 不提供签证 / 未知;硕士可投 / 仅限博士;工程岗 / 非技术岗 |
| jd_status missing/login_wall/unreachable | 无正文 / 登录墙 / 打不开 |
| 海投 | 海投(保留) |
| profile.yaml、sqlite、claude-in-chrome、reapStaleRuns、答案包 | 不出现;设置页可写「需要 Claude 桌面应用的 Chrome 扩展已连接」 |
| Dashboard / Resume Studio / Profile / Networking 漏斗 / Outreach | 统计 / 简历 / 档案 / 人脉漏斗 / 联系记录 |

## 6. 技术方案

- 仍是 Next.js 15 App Router + 现有服务端取数(页面 server component 首屏 + 客户端 fetch 轮询)。不引入状态库、不引入 Tailwind;新增依赖只有 `lucide-react`。
- CSS:`globals.css` 只 `@import` 五个文件:`tokens.css`、`base.css`、`shell.css`、`components.css`、`pages.css`;类名前缀按组件(`.btn`、`.chip`、`.card`、`.drawer`…)。
- 客户端刷新:`useRouter().refresh()` 代替 `location.reload()`;列表类操作优先本地乐观更新。
- 主题:`<html data-theme="light|dark">` 由内联脚本在首屏根据 `localStorage` 设置;CSS 以 `:root` 浅色为默认,`@media (prefers-color-scheme: dark)` 配合 `:root:not([data-theme="light"])`,再 `:root[data-theme="dark"]` 覆盖。
- 路由级:每个页面目录加 `loading.tsx`(骨架);根 `error.tsx`、`not-found.tsx`;`icon.svg`;`metadata` 标题模板。
- 可测试的纯逻辑抽到 `src/app/lib/`(`labels.ts` 标签映射、`time.ts` 相对时间、`plan.ts` 投递计划构造、`log-steps.ts` 日志行 → 步骤分类、`answers-labels.ts`),用 vitest 覆盖。
- 页面文件拆分:每页 `page.tsx`(server,取数)+ `*-client.tsx`/若干组件;单文件 ≤ 400 行。

## 7. 允许的后端改动(全部是只读、增量、带测试)

1. `GET /api/overview`:`{ assistant: {run|null}, counts: { awaitingConfirm, needsInfo, referralDrafts, referralProgress, networkDrafts, queueMatched, submittedToday, submittedThisWeek, referralInFlight }, today: string }`,由现有函数组合(`executorStatus`、`pendingConfirmations`、`pendingInfo`、`referralBoard`、`todaySubmitted`、`weekly`、`queueByDirection`、outreach 查询)。
2. `pagedQueue` / `pagedAllJobs` 新增可选 `q`(公司或标题 `LIKE %q%`);`GET /api/queue?q=` 透传。
3. `GET /api/settings`:`{ ntfyConfigured: boolean }`。
4. `PUT /api/experiences/[id]` 已存在(编辑经历不需要新后端)。

不改:执行器协议、任何 POST 语义、schema。

## 8. 分阶段落地(每阶段结束 App 可用、测试绿、提交一次)

| 阶段 | 内容 |
|------|------|
| P0 | 设计系统:tokens/base/components CSS、UI 组件库、`lucide-react`、App 壳(侧栏/顶栏/主题)、Toast/Dialog/Drawer、`/api/overview`、标签映射与纯逻辑 + 测试、`loading/error/not-found`、图标与 metadata |
| P1 | 今日(首页)+ `AssistantCard` + 共享确认卡/待补信息卡组件抽出 |
| P2 | 职位:行组件、工具栏、搜索(`q`)、详情抽屉、跳过撤销通知、分页、手机布局 |
| P3 | 投递:计划卡、助手卡、待确认/待补信息/内推进行中/需人工/今日已提交 全部换新组件与对话框;设置页(执行方式迁出) |
| P4 | 历史 + 统计 |
| P5 | 人脉 |
| P6 | 档案(经历可编辑、简历预览、标准答案友好标签)+ `/studio` 重定向 |
| P7 | 设置页补全(外观/通知/信息源)+ `/sources` 重排 + 全站文案审计(§5)+ 可达性/响应式/深色三遍检查 + CLAUDE.md/README 更新 |
| P8 | 端到端验证(1280 / 375,浅/深,每页截图)、`npm run build`、`npm test`、合入 main 并部署 |

## 9. 不做

- 多用户/登录、Phase B 产品化、Windows 迁移。
- 改扫描/匹配/执行器逻辑;改任何 POST 接口的语义;改 schema。
- 新的业务功能(除「编辑经历」与「设置页」这两个属于市场级基本盘的补缺)。
- 引入 UI 框架(Tailwind / shadcn / MUI)。

## 10. 风险与对策

- **协议文档漂移**:CLAUDE.md §3 与技能文件里写的「/apply 待补信息卡片」等位置名要跟着改;API 不动,所以值守会话不受影响。
- **共享数据库的开发验证**:开发服务器跑在 3001 端口、`SCAN_TICK_DISABLED=1`、使用 `data/jobseeker.db` 快照(与生产库隔离),破坏性操作只在快照上试。
- **字体**:仍用 `next/font/google` 自托管三款字体;中文回退 PingFang SC / Noto Sans SC。
- **深色模式回归**:所有新颜色只经 tokens,P7 逐页检查。
