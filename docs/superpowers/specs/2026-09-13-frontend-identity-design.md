# Sortie 前端视觉身份「Dispatch」— 设计说明(2026-09-13)

## 0. 为什么重做

2026-09-08 的「制版间」版本功能完整,但视觉上是一眼可辨的 AI 生成风:米黄纸底、衬线斜体品牌字、大写加字距的小标题、左侧图标导航、到处是 chip 和 1px 描边卡片、每个标题下都挂一句解释。用户要求:有质感、有个性、像有审美的前端工程师做的、会有很多用户的正经产品。这次只换视觉层与壳,API、执行协议、术语表与交互契约(Dialog / Toast 代替原生弹窗、不整页刷新)全部不变。

## 1. 概念

Sortie = 一次出击并返航。App 是一张**调度台**:安静、精确、可触。三条原则:

- **一种信号色**。国际橙 `#ea4a1b`(深色下 `#ff5a2c`),只用在需要眼睛去的地方:主按钮、活跃下划线、角标、进行中的脉冲点、置顶行的左缘。分数不用橙(队列前排全是高分,橙就失效了)。
- **数字是仪表**。所有计数、分数、时间戳、编号用 Martian Mono(等宽,带宽度轴;账本大数字 wdth 100,列表分数 87.5,时间戳 90)。其余拉丁文用 Archivo(带宽度轴;字标 wdth 112),中文走各平台系统黑体(PingFang / YaHei / Noto),这也是真实中文产品的做法。没有衬线、没有斜体、没有大写字距。
- **表面有材质**。纸(`#f3f2ef`)与沥青(`#0f0f10`)两套中性色;整页铺 5% / 7.5% 的单色细颗粒噪点(`body::before`,SVG feTurbulence);发丝线用 rgba 而不是实色灰;控件有顶部高光和底部阴影、按下会下沉 1px;主按钮是橙色纵向渐变加内高光;圆角 4 / 6 / 10 / 14。

## 2. Tokens(`src/app/styles/tokens.css`)

| 组 | 浅色 | 深色 |
|---|---|---|
| canvas / surface / surface-2 / surface-3 / sunken / pop | `#f3f2ef` / `#fff` / `#f7f6f3` / `#ecebe6` / `#e9e8e3` / `#fff` | `#0f0f10` / `#161617` / `#1c1c1e` / `#242427` / `#0b0b0c` / `#1d1d20` |
| ink / ink-2 / sub / faint | `#171716` / `#3d3c39` / `#6f6e69` / `#a3a29c` | `#ecebe7` / `#c7c6c1` / `#8f8e88` / `#5f5e59` |
| line / line-2 / line-strong | rgba(23,23,22,.09 / .15 / .32) | rgba(255,255,255,.08 / .13 / .28) |
| accent / hover / active / soft / ring | `#ea4a1b` / `#d64012` / `#bf3810` / `#fdeae3` / rgba(234,74,27,.26) | `#ff5a2c` / `#ff7048` / `#e8471b` / `#33190f` / rgba(255,90,44,.32) |
| good / warn / danger / info | `#1f7a4a` / `#a86b0b` / `#c2302b` / `#2d5fa6`(各有 -soft) | `#4cc27a` / `#e2ab3d` / `#f06262` / `#6ea2ea` |

阴影三级(`--shadow-1/2/3`),动效 `--ease-out` `cubic-bezier(.16,1,.3,1)` 与 `--ease-spring`,时长 150 / 240ms,`prefers-reduced-motion` 归零。字号 11 / 12.5 / 14 / 15 / 18 / 24 / 30。字体变量由 `next/font/google` 注入:`--font-archivo`(axes wdth)、`--font-martian`(axes wdth)。`?theme=light|dark` 查询参数可临时覆盖外观(截图、分享),不写入 localStorage。

## 3. 壳(`src/app/styles/shell.css`,`components/shell/*`)

- 桌面:56px 半透明顶栏(backdrop blur)= 品牌标(圆环缺口 + 橙色离场箭头,`logo.tsx`)+ 字标 · 七个文字入口(活跃项橙色下划线滑入,角标为橙色圆角计数)· 右侧助手胶囊(点 + 「助手 · 任务 · 状态」)、搜索按钮(显示 ⌘K / Ctrl K)、外观、设置。内容居中 1160px。
- 手机(≤880px):顶栏只留品牌、助手胶囊、搜索;底部 5 格标签栏(今日 职位 投递 人脉 更多),「更多」是底部弹层(历史 档案 统计 · 外观 · 设置)。
- 命令面板(`components/command-palette.tsx`):⌘K / Ctrl K 打开;页面、动作(开始投递、看队列、切换外观)、职位实时搜索(`/api/queue?direction=__all__&q=`,选中跳 `/queue?direction=&q=`)。只导航,不提交、不发送。

## 4. 组件语言(`src/app/styles/components.css`)

| 组件 | 现在的样子 |
|---|---|
| Button | 32px(sm 26),圆角 6,发丝边 + 顶部高光;primary 橙色渐变;ghost 无边;danger 红字 |
| Chip | 20px 高、圆角 4、11.5px、色底同色字;outline 版发丝边 |
| Card | 白面 + 发丝边 + 圆角 10 + 一级阴影;warn / good / accent 语气 = 边线染色 + 顶部 88px 的淡色渐变 |
| Section | 15px 半粗标题 + 等宽淡色计数,不再有顶墨线和大写字距 |
| StatStrip / Stat | 「账本」:一排格子,格间 1px 发丝线(gap 技巧),数字 26px Martian Mono;compact 版 20px;只有一格时收缩为 inline-grid |
| Tabs | 下划线式,活跃项橙线滑入;方向 tab 带 `T1/T2/T3` 梯队小标 |
| Segmented | 凹槽轨道 + 白色浮起的活跃项 |
| Menu / Dialog / Drawer | 圆角 10 / 14,三级阴影,pop 动画;Drawer 是桌面上离边 8px 的浮动面板,手机全屏 |
| Toast | 深色面、左侧语气圆点(不再是左边条) |
| EmptyState | 线描插画(`ui/illustrations.tsx`:inbox / radar / ledger / people / paper / compass / warn,单一线宽 + 一个橙色细节),无虚线框 |
| PageHeader | 新增 `kicker`(标题上方一行小字);解释性副标题基本删除 |

## 5. 页面

- **今日**:kicker 是日期,标题即状态(「有 N 件事等你决定」/「今天没有需要你决定的事」);助手条 → 账本(队列可投 / 今日 / 本周 / 内推进行中)→ 需要你处理 → **队列前排**(主方向前 5 条,点进 `/queue?direction=&q=&job=` 直接打开详情)。
- **职位**:≥1200px 时列表 + 右侧粘性详情面板(`queue-panel`,复用 drawer-head/body/foot 的类),列表不被遮;更窄用抽屉。`?job=<id>` 到达即打开;`j` / `k` 上下切换、`Esc` 关闭(输入框聚焦或有弹层时不响应)。详情逻辑抽到 `queue/job-detail.tsx`(`useJobDetail` 缓存 + `DetailHead/Body/Footer`),`job-drawer.tsx` 导出 `JobDrawer` 与 `JobPanel`。
- **投递**(2026-09-14 改):助手卡、「本次投递计划」之后,待处理 / 待确认 / 内推进行中 / 今日已提交不再从上到下摞着,而是一排 Tabs(与档案页同一个组件,标签带计数,计数取自 `/api/overview`,与顶栏角标、今日页账本同一套数字);点哪个显示哪个,四个面板同时挂载只显示一个(切换即时、填了一半的答案不丢);当前标签写进 `?tab=`(replaceState,同档案页),无 `?tab=` 时打开第一个非空的(`src/app/lib/apply-tabs.ts`);板块说明只留在空态里。
- **历史 / 人脉 / 档案 / 设置 / 统计**:结构不变,去掉解释性副标题(历史用 kicker 显示已提交份数),空态换线描插画。
- **助手卡**:助手用品牌标代替机器人图标;上次任务摘要两行截断 + 「展开全文」(补正文的摘要会列出 40 个岗位)。

## 6. 验证方法

`tsc --noEmit`、vitest 全绿(含 `tests/ui-nav.test.ts`)、`next build`。截图用无头 Chrome:`chrome.exe --headless=new --hide-scrollbars --user-data-dir=<临时目录> --window-size=1280,900 --virtual-time-budget=9000 --screenshot=out.png http://127.0.0.1:3001/?theme=dark`。注意无头窗口有最小宽度,手机宽度的截图会比视口宽,手机布局要在 Claude 桌面 App 的浏览器面板(mobile 预设)里看。
