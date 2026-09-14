# 待处理清单:取消「需人工」板块(2026-09-13)

## 0. 结论与用户决定

用户 2026-09-13 看到投递页「需人工 5」后明确:**不接受任何「归档到需人工就没有下文」的板块**,要的是全自动;缺文件或缺信息的申请都应该走待补信息;创建账号这类事用户愿意授权。助手(Claude)这边创建账号 / 输入密码是硬性禁止项,用户授权也不解锁,所以登录墙改成「登录一次」卡:用户在求职 Chrome 里登一次,Chrome 记住会话,之后全自动。

四个分岔用户都选了推荐项:

1. **登录墙** → 「登录一次」卡片:助手报出准确链接,用户登完点「我登好了」,同一网站上所有暂停的岗自动续跑。不做计划前预检。
2. **要写的内容**(cover letter、「为什么想来贵司」)→ 助手只用经历表的真实事实草拟,写进待确认卡,用户审过再提交。
3. **真做不了的**(录视频、同一岗连续出错)→ 和其他待办同一张清单里的「需要你亲自完成」卡,带链接和「放弃」;没有独立板块,也不会悄悄消失。
4. **死链 / 已投过** → 自动处理不打扰:死链归档并静音板块;已投过记入历史为已提交(提交日期未知)。

库里当时的 6 条(含待补信息里超时的 Ciena)按新模型全部有去处:成绩单 ×3 → 文件项;GPA / 技术栈 / sponsorship 类型 → 文字项;「1–4 月能否全职」→ 带选项的文字项 + 卡上的「跳过这个岗」;Anysphere 整板 404 → closed + 静音;Apple / L3Harris → 登录一次。

## 1. 模型

一条待办 = `applications.pending_questions` 里的一个**项目**(JSON 数组,老结构兼容,`kind` 缺省为 `text`):

```ts
interface InfoQuestion {
  key: string;        // text: 标准答案键名;file: 文件键名(transcript);login/action/manual: 任意标识
  label: string;
  hint?: string;
  options?: string[]; // text: 下拉的精确选项
  optional?: boolean;
  kind?: "text" | "file" | "login" | "action" | "manual";
  multiple?: boolean; // text+options: 可多选,答案 = 选中项用 "; " 连接
  url?: string;       // login: 登录/注册页;manual: 要亲自完成的页面(缺省用岗位 apply_url)
  host?: string;      // login: 这堵墙属于哪个 apply_url 主机,「我登好了」按它一次解决全部
  accept?: string;    // file: 接受的扩展名,如 ".pdf"
}
```

两种停法:

- **等你**(`status = needs_info`):助手停在标签页上轮询,适用 text / file / action。30 分钟没答 → 助手报 `needs_manual`(reason = timed out),行变成暂停但项目保留。
- **暂停**(`status = matched` + `needs_manual_reason` + `pending_questions`):助手已经去做别的。`login` / `manual` 项目一律直接暂停(助手不等)。

处理完自动续跑:等你 → `prepared`(助手接着填);暂停 → 清空 reason/questions,并定向入队 `{jobIds, mode:'direct'}` 的 user_chrome run(已有 run 在跑或排队就不入队,下次运行会带上)。

每张卡都有「跳过这个岗」(归档,通知条可撤销);暂停中的表单卡另有「让助手重新来」(清空项目后定向续跑,让助手按新协议重新问)。

自动处理(执行器新状态,App 直接落地,不出卡):

- `closed`(死链 / 岗位已下线):归档该申请、`jobs.jd_status = 'closed'`;`boardGone:true` 时把 `jobs.board_key` 的板块静音(`muteBoard`)。
- `already_applied`:`recordExternalSubmission` → `status = submitted`、`submitted_at = now`、`application_stage` 事件备注「助手发现此前已投过,日期未知」;进历史页可跟 OA / 面试。

其他变化:

- **确认超时不再报 needs_manual**:行留在 `awaiting_confirm`,待确认卡不消失;用户晚点批准 → decide 自动入队 resume run(既有路径 §3.7 b)。
- `error` → `manual` 项 `{key:'error', label:'助手出错,没填成', hint: reason}`,卡上「让助手再试一次 / 我自己投完了 / 放弃」。
- `decide reject` → `manual` 项 `{key:'rejected', label:'你退回了这份填写', hint: reason}`,并把 reason 写进 `info_answers.rejection_note`;再填时 `answerPack.custom.rejection_note` 带着,执行器据此改。
- 取件时的「没有 apply_url / 这个方向没生成简历」也写成 `manual` 项(后者 `url = /profile?tab=resumes`)。
- 老格式 `needs_manual`(没有 eligibility、没有 archive)仍接受:有项目就保留,没有就用 reason 合成一个 `manual` 项;`pendingInfo` 读到只有 reason 的老行也合成——所以不需要迁移,schema 版本不变(v14)。

**文件**:`data/documents/<key>.<ext>`(DATA_DIR 下;键名 `^[a-z][a-z0-9_]{0,39}$`,扩展名白名单 pdf/doc/docx/png/jpg/jpeg/txt,≤15 MB)。答案包新增 `documents: {key: 绝对路径}`;`file` 项的答案 = 上传后返回的绝对路径,写进 `info_answers`,**不进标准答案**(文件本身已经是长期资产)。档案页新增「文件」标签管理。执行器规则:表单要传文件先看 `answerPack.documents[key]`,没有才报 `file` 项;拿到 `infoAnswers[key]` 用 `file_upload`。

**经历亮点**:答案包新增 `experiences`(`pickHighlights` 按岗位方向挑的前 6 条 work/project 真实要点,与人脉草稿共用,搬到 `src/resume/highlights.ts`),给 cover letter / 自由陈述草拟用;写进 filledFields 由用户在待确认卡审阅。

**登录墙**:执行器报 `needs_info` + `{kind:'login', host:<apply_url 主机>, url:<登录/注册页>, label, hint}` → 直接暂停。`takeNextApplication` 取到同 host 有未解决登录项的岗时,直接用同一个项暂停(不重复撞墙、不触发熔断)。「我登好了」`POST /api/apply/login-done {host}` → `resolveLogin`:去掉所有暂停行里该 host 的登录项,没剩项目的行清空并定向入队。同一 host 的多张卡在 UI 上合成一张,列出受影响岗位。

## 2. API

| 接口 | 变化 |
| --- | --- |
| `POST /api/apply/report` | `status` 增 `closed`(可带 `boardGone`)/ `already_applied`;`needs_info` 的 `questions[]` 支持 `kind` 等字段;`login`/`manual` 直接暂停;通知文案按 kind |
| `POST /api/apply/answer-info` | 校验 `file` 答案在 documents 目录内;暂停行答完定向入队;返回 `{status, autoStarted}` |
| `POST /api/apply/login-done` | 新:`{host}` → `{jobIds, autoStarted}` |
| `POST /api/apply/unpark` | 也清 `pending_questions`;定向入队;返回 `{autoStarted}` |
| `POST /api/apply/self-submitted` | 新:`{jobId}` → 记为用户自己提交 |
| `POST /api/apply/archive-manual` | 放宽到 `needs_info` 行和带项目的行(卡上的「跳过这个岗」) |
| `GET/POST/DELETE /api/documents` | 新:列出 / 上传(multipart `key` + `file`)/ 删除 |
| `POST /api/apply/next` | 答案包带 `documents` 与 `experiences` |
| `GET /api/overview` | `counts.manual` 删除(全部并入 `needsInfo`) |

## 3. 页面

- 投递页:删除「需人工」板块;「待补信息」改名**「待处理」**,描述「助手停下来等你的事:补答案、传文件、登录一次,或你亲自完成。做完自动继续。」空态「没有等你的事」。首页「需要你处理」区继续用同一组件(compact)。
- 卡片按项目类型渲染:文字 / 下拉 / 多选 / 文件(上传或选已有文件)/ 现场完成(勾「完成了」)/ 登录一次(打开登录页 + 我登好了)/ 亲自完成(打开申请页 · 让助手再试一次 · 我自己投完了 · 放弃)。类型标签:补信息 · 传文件 · 登录一次 · 现场完成 · 亲自完成。
- 档案页:第四个标签「文件」:列表(标签、文件名、大小、时间)、上传(常用键名下拉 + 自定义)、删除。
- 文案里不出现 needs_manual / needs_info / kind 等内部词。

## 4. 执行协议改动

- CLAUDE.md §3.4 重写为「停下来等你」规则表;§3.7 确认超时不再报 needs_manual;§3.8 熔断改为「连续 3 次暂停」;§6 投递页结构。
- `.claude/skills/apply-executor/SKILL.md` §2 步骤 4/5、§5 触发条件表(每种情况 → 报什么)、§7 熔断。
- `src/executor/prompts.ts`(headless):登录墙 → `login` 项(hint 指向设置页「后台浏览器」)、§3 列表改成 kind 表、第 4 步超时不再回报。

## 5. 测试

`tests/apply-info.test.ts`(kind 分流、login 直接暂停、file 不进标准答案、多选校验、resolveLogin、旧行合成)、`tests/apply-queue.test.ts`(closed / already_applied / error 卡 / reject 卡 / 同 host 登录墙跳过 / 答案包 documents+experiences)、`tests/apply-history.test.ts`(recordExternalSubmission、archiveManual 放宽)、`tests/documents.test.ts`(键名与扩展名校验、覆盖同键、列出/删除)、`tests/scanner-boards*.test.ts`(muteBoard)。
