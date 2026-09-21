# 界面内问答助手(问助手)设计 — 2026-09-18

## 1. 背景与目标

用户(2026-09-18)要求:在 App 界面里直接接入一个 AI 助手,有关于某个任务运行情况的问题、或者
任何关于 App 功能怎么用的问题,都能在 App 里面直接问,不用去翻日志、翻文档、也不用打开 Claude
桌面 App;**最好直接用 Claude 的订阅**(不另配 API key)。

现状:助手(执行器)的状态只能从助手卡、「查看步骤」的逐行日志、待处理 / 待确认卡上拼出来;
功能说明散在 spec 与 CLAUDE.md 里,用户看不到。

## 2. 原则

- **只读**。问答助手只回答,不替用户点任何按钮:不开始任务、不批准、不停止、不改设置。要做的事它
  告诉用户去哪一页点什么。提交 / 发送的批准闸门与之完全无关。
- **只说看得到的**。回答只能基于 App 交给它的快照(下文 §4)和功能说明;快照里没有的就说没有,并
  告诉用户在哪一页能看到。绝不编造任务进度、绝不猜测日志里没写的原因。
- **用户口径**。回答里用界面上的词(助手、任务 #N、待处理、待确认、内推进行中、海投 / 找内推、
  信息源…),不出现 run / executor / user_chrome / headless / pid 这类内部词;按当前界面语言作答。
- **用 Claude 订阅**。默认走 `subscription` 后端(本机 `claude` CLI 的登录),设置页可改成「跟随
  AI 提供方」(与投递 / 匹配同一个选择)。CLI 以**裸模式**启动:自定义系统提示、不加载任何工具、
  不加载 settings / CLAUDE.md、不启动 MCP——它读不到仓库,也不会把职位文本当指令去执行任何东西。
- **边际效益**。没有会话持久化、没有向量检索、没有工具调用循环:一次问答 = 一份快照 + 一段说明
  + 最近几轮对话 → 一次补全(能流式就流式)。对话只存在浏览器 sessionStorage 里,关标签页就没了。

## 3. 界面

- 入口三处:顶栏助手胶囊右边的「问助手」按钮(`MessageCircleQuestionMark` 图标,手机端只显示图标)、
  手机「更多」弹层里一项、⌘K 命令面板一条动作;快捷键 `⌘/`(Windows `Ctrl+/`)。
- 打开一个右侧 Drawer(手机全屏):标题「问助手」,副标题一句(只读、看得到什么);正文是消息列表;
  空态给四个可点的示例问题(助手现在在做什么 / 上一次任务为什么没完成 / 待处理卡怎么处理 /
  自动投递是什么);底部输入框(Enter 发送,Shift+Enter 换行)+ 发送按钮 + 「清空对话」。
- 助手回复流式逐字出现;渲染极简 Markdown(段落 / 列表 / **粗体** / `代码` / 站内链接,链接点了
  关抽屉并跳转)。出错在气泡里显示并可重试,不弹原生对话框。
- 对话跨页面保留(状态在 AppShell 的 Provider 里,持久化到 `sessionStorage` `sortie.chat`),
  最多留 40 条;抽屉开着时每次发送都带上最近 12 条作为上下文。
- 界面文字全部走文案树 `src/i18n/messages/chat.ts`(zh / en)。

## 4. 快照(`src/assistant/context.ts`)

每次提问服务端现算一份纯文本快照,按账号取数(全部复用现有只读函数):

- 账号与设置:名字、界面语言、今天日期、AI 提供方、自动投递开关、档案是否完整、执行方式说明。
- 数字条(`overview` 的 counts):待确认 / 已批准待提交 / 待处理 / 内推草稿 / 内推进行中 / 人脉草稿
  / 队列可投 / 今日已提交 / 本周已提交。
- 任务:最近 10 条(`executorStatus`):编号、类型、状态(按计划达标判断的展示标签)、通道、内容
  (`describeRun`)、进度与去向(`runProgressText` / `runBreakdownText`)、开始 / 结束时间、摘要
  (截 400 字);进行中 / 排队的附最近 20 行日志。
- **被点名的任务**:问题里出现 `#118`、「任务 118」、`task 118`、`run 118` → 取该任务详情 + 最近
  120 行日志(每行截 240 字),最多 3 个。不在最近 10 条里也取得到(`getRun`)。
- 待确认列表(公司 / 岗位 / 方向 / 是否已批准 / 是否带内推)、待处理卡(公司 / 岗位 / 状态 /
  每项的 kind + label)、内推进行中(公司 / 岗位 / 每位联系人的关系 + 阶段)、今日已提交、队列
  按方向的数量、信息源最近一跳(时间 / 板块数 / 新入库 / 出错数)。
- 每段有上限(列表各 ≤20 行),整份快照约 3–6k tokens。

## 5. 提示词与后端(`src/assistant/chat.ts`)

- `system` = 角色与规则(§2 的五条 + 「不知道就说不知道」+ 「不复述整份快照,只答所问」)+ 功能说明
  `src/assistant/guide.ts`(英文写的用户视角说明:每一页是什么、投递流程、卡片与状态的含义、任务标签
  的含义、接力、自动投递、内推流程、信息源、设置、常见问题;附中文界面词表,让回答里的名词和界面一致)。
- `prompt` = 快照 + 最近对话转写(`User:` / `Assistant:`)+ 最后一条用户消息 + 「用 {语言} 回答」。
- `LlmRequest` 新增 `bare?: true`:后端应替换默认系统提示、不加载工具 / 设置 / MCP。`subscription`
  后端映射为 `--system-prompt`、`--tools ""`、`--setting-sources ""`(加原有 `--strict-mcp-config`);
  codex 本来就是隔离的 `exec`;openai 直连无所谓。
- `LlmBackend` 新增可选 `stream(req, onDelta)`:`subscription` 用 `--output-format stream-json
  --verbose --include-partial-messages` 逐行解析 `content_block_delta.text_delta`,`result` 行给最终
  文本;其他后端没有就退回 `complete`。`tier: "smart"`,`maxTokens` 1200。
- 后端选择 `src/assistant/provider.ts`:`profile` 表 `chat_provider:<userId>` = `claude`(默认)|
  `follow`;`claude` → `getBackend("subscription")`,`follow` → `getBackend()`。

## 6. 接口

- `POST /api/assistant/chat {messages:[{role:'user'|'assistant',content}]}`(withUser)→ NDJSON 流:
  `{"delta":"…"}` 若干行,最后 `{"done":true,"text":"…","backend":"subscription"}` 或
  `{"error":"…"}`。消息 ≤ 12 条、每条 ≤ 4000 字,最后一条必须是 user。语言取请求 cookie。
- `GET/POST /api/settings/chat-provider {provider:'claude'|'follow'}`;`GET /api/settings` 多返回
  `chatProvider`。

## 7. 设置页

「AI 提供方」区下新增「问答助手」小节:Segmented「Claude 订阅」/「跟随 AI 提供方」,一句说明
(问答只读、用哪个模型)。文案 `settings.chat`。

## 8. 测试

- `tests/assistant-chat.test.ts`:快照含任务 / 待确认 / 待处理 / 数字;点名 `#N` 时带上日志;
  提示词含说明、语言与转写;消息校验(空 / 过长 / 最后一条不是 user);`answerChat` 用假后端能拿到
  流式 delta 与最终文本;有 `stream` 用 stream、没有退回 complete;provider 设置默认 claude。
- `tests/subscription-backend.test.ts`:bare 模式参数;`parseStreamLine` 解析 delta / result / 忽略
  其他行;`stream()` 用假 runner 汇总文本、非零退出抛错。
- `tests/ui-chat-markdown.test.ts`:段落 / 列表 / 粗体 / 代码 / 站内外链接的解析。
- `tests/i18n.test.ts` 自动覆盖新文案的 zh / en 对齐。

## 9. 让它动手:「帮我投递这个岗位」(2026-09-18 晚,用户追加)

用户:「我看到 Amazon 27 summer intern 开岗位了,直接跟助手说帮我投递这个岗位,它就直接帮我投了,然后放到
历史里。」于是问答助手多了三件能做的事(`src/assistant/tools.ts`),其余仍然只答不动:

- `search_jobs {query}`:在职位库按公司 / 标题逐词匹配(每个词都要命中),最多 8 条,带分数、方向和
  这个账号的状态(在队列 / 已归档及原因 / 待确认 / 已投过 / 未打分 / 重复行)。
- `apply {jobId, force?}`:对一个岗位排一个**定向投递任务**(`queueTargetedRun`,和待处理卡的「让助手
  再试一次」同一条路:有排队的定向任务就并进去,有任务在跑就排在后面)。没打分的先用全局 AI 提供方现打
  一次(`runMatching` 新增 `jobIds`,正文为空先 `fetchJdText`);已归档(不 sponsor / 仅限博士 / 低分)
  或停在待处理卡上的**不悄悄投**:告诉用户原因,用户坚持才 `force:true`(归档的 `unarchive`);已投过 /
  待确认中 / 重复行 / 没链接 → 只说明。之后的流程一字不改:助手在用户 Chrome 里填 → 待确认卡(或自动
  投递开着就直接提交)→ 今日已提交 / 历史。
- `add_job {url, company, title, location?}`:用户贴链接、库里没有 → `upsertJobs` 以 `source:'manual'`
  入库(先抓一次正文,抓不到就空着,投递时读活页面),然后走 `apply`。

协议:模型只能回**一整行** `ACTION: {json}`(`parseAction`),服务端执行、把观察结果追加到提示词里
再问一次,最多 4 轮(`MAX_TOOL_ROUNDS`);`deltaGate` 把每轮开头几个字符扣住,判断是 ACTION 就整段吞掉,
不是才流给用户,所以用户只看到最后的回答。每个工具的结果同时作为 `{"action":{…}}` 事件进流,抽屉在气泡下
显示「已开始投递 · 任务 #N」(点了去投递页)或「已加入职位库」。红线不变:提交仍只能由 App 批准,
发消息没有工具;工具只以当前账号执行。测试 `tests/assistant-tools.test.ts`。

### 9.1 「上网找」(2026-09-21,用户追加:「你需要有能上网找的功能」)

第四个工具 `find_online {query}`(`src/assistant/tools.ts` `findOnline`):借用聊天模型自己的联网能力——
`LlmRequest.webTools`,subscription 后端在裸模式下把 `--tools ""` 换成 `--tools WebSearch,WebFetch
--allowedTools WebSearch WebFetch --max-turns 8`(仍然 `--setting-sources ""`,没有 shell / 文件工具),
单独一次补全:系统提示只许回 JSON 数组 `[{url,company,title,location}]`,只要官方招聘页(公司官网 / ATS,
不要 LinkedIn / Indeed 等聚合站),偏向美国岗;`parseOnlinePostings` 过滤聚合站与坏链接,≤5 条。结果里每条标注
「已在库 #N(状态)」或「不在库 → add_job」,模型再按用户意图 `add_job` → `apply`。只有 Claude 订阅有联网工具:
聊天模型是 Codex / GPT 时工具直接回「需要把问答助手切到 Claude 订阅」。`MAX_TOOL_ROUNDS` 提到 6(库内搜 →
上网找 → 入库 → 投 → 回答)。实测一次上网找约 12–60 秒,约 2 轮。规则:库里没有合适的、或用户明确要上网 /
要别的季节的岗位时才用;绝不投用户没要的岗。
