# 自动投递(全自动模式)设计 — 2026-09-17

## 1. 背景与目标

用户(2026-09-17)要求:设置里加一个开关,开着时投递流程**不需要用户点确认**,而且**缺答案的题也由
助手按用户的情况自行作答**,只有实在做不到的事(创建账号、登录、验证码、缺文件、必须亲自完成的题)
才回来找用户——这样用户有事、专心干活或学习时,投递不会停。

之前的流程有两处必须等人:填好后的「待确认」卡(`confirm_decision` 为空,`reportSubmitted` 红线不放行)
和缺答案时的「待处理」卡(`needs_info` → 用户答完才续跑)。

## 2. 原则(不变的红线)

- `reportSubmitted` 仍只在 `status='awaiting_confirm' AND confirm_decision='approved'` 时放行。开关只改
  **谁来批准**:用户点卡 → App 在收到回报的那一刻自己批准。会话永远不自己判断「可以提交」,批准只能来自
  App 的响应(`autoApproved:true`)或终端消息(`[Sortie] approved`)。
- 重新回报 awaiting_confirm 仍然清空批准;开关开着才会再次自动批准。
- 自动作答**只用用户自己的事实**(档案、标准答案、经历表)。答不出来的(GPA、高中、档案里没有的数字)
  返回 null,留在卡上;绝不编造。签证 / 工作授权按事实原样答,不往好听处靠。
- 发给人的消息(内推 / coffee chat)**不受开关影响**,永远要用户批准。
- 会话该报 needs_info 的照报,不因为开关开着就少问或自己编——判断能不能替答是 App 的事。

## 3. 数据

- 开关按账号存 `profile` 键值表:key `auto_submit:<userId>`,值 `true|false`(`src/apply/auto-submit.ts`
  `getAutoSubmit / setAutoSubmit`)。不改 schema。
- 自动答出的文本答案与用户手答一样:存到 `applications.info_answers`,并写进档案 `standard_answers`
  (档案页「标准答案」可改)。事件 `application_info_auto_answered` / `..._failed`。

## 4. 接口

- `GET /api/settings` 多返回 `autoSubmit: boolean`;`GET/POST /api/settings/auto-submit {enabled}` 任何登录
  账号改自己的。
- `POST /api/apply/report`(`src/app/api/apply/report/route.ts`):
  - `status:'awaiting_confirm'` + 开关开 → `decide(approve)` → 响应 `{ok:true, autoApproved:true}`。
  - `status:'needs_info'` + 开关开 + 不是 login/manual 项 → `autoAnswerPending`(`src/apply/auto-answer.ts`,
    所选 AI 提供方 `getBackend()`,`tier:'smart'`):
    - 全部必填 text 项都答出来、且没有 file/action 项 → 走 `answerInfo`(状态 → `prepared`,答案合并、
      记入标准答案)→ 响应 `{ok:true, autoAnswered:true, infoAnswers}`;不发通知。
    - 否则:答出来的存起来、`pending_questions` 收缩到剩余项,照常发「待处理」通知 → 响应
      `{ok:true, autoAnswered:'partial'|false, remaining:[key…]}`。
    - 模型失败 → 普通卡,响应 `autoAnswered:false`。
  - `status:'submitted'` + 开关开 → ntfy「已自动投出 <公司>」(`notify.autoSubmitted`)。
- 开关关着时所有响应与之前完全一致(`{ok:true}`)。

## 5. 会话协议(CLAUDE.md §1 / §3.6、`buildAttendedPrompt`、headless `buildApplyPrompt`、apply-executor SKILL §2/§6)

- 回报 awaiting_confirm 后**看响应**:`autoApproved:true` → 不等、不轮询,同一标签页重读核对后提交、报
  submitted;没有就照旧停下等 `[Sortie] approved`(桌面会话按 Monitor 的 APPROVED 行 / 轮询 pending)。
- 回报 needs_info 后**看响应**:`autoAnswered:true` → 原地把 `infoAnswers` 填进去、回读、回报
  awaiting_confirm(接着又会被自动批准);`partial|false` → 剩余项等用户,照常取下一个。
- 兜底不变:会话没接住的批准由 `requeueStrandedApprovals`(finish 路由 / 调度器每 10s)排 resume run;
  `prepared` 行 30 分钟没动静由 `reclaimStrandedPrepared` 收回成定向 run。

## 6. 界面

设置页新增「自动投递」区(在「AI 提供方」之上):两张 RadioCard「填好后等我确认」/「全自动:填好直接提交」
(开着时带「已开启」chip),文案 `settings.autoSubmit`(zh / en)。待确认卡、待处理卡本身不变——开关开着时
它们只会短暂出现(自动批准后显示「已批准 · 等助手提交」直到会话报 submitted)。

## 7. 测试

`tests/apply-auto-submit.test.ts`:开关默认关 / 按账号;关着时红线仍拦;开着时回报即批准、可提交;重报清空
批准且关掉开关后不再自动批准;提示词包含事实与题目;`parseAutoAnswers` 只收真实题、丢 null 与选项外答案;
全答出 → prepared + 标准答案;部分答出 → 卡收缩到剩余项;模型失败 → 卡不变;无档案 / 无 text 项 → 跳过。
`tests/executor-attended.test.ts` / `tests/executor-prompts.test.ts` 断言提示词含 `autoApproved` / `autoAnswered`。
