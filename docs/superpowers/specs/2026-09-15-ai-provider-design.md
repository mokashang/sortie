# Sortie AI 双后端设计（2026-09-15）

## 目标

所有需要模型判断或代理工具的步骤都服从设置页的同一个 AI 提供方选择，不出现“打分用了 GPT、投递却仍固定 Claude”的半切换状态。

## 提供方

| 设置项 | 纯文本任务 | 浏览器/工具任务 | 认证 |
|---|---|---|---|
| Codex | `codex exec`，禁用项目工具与 MCP | Codex CLI + 现有浏览器工具或内联 Playwright MCP | 本机保存的 Codex/ChatGPT 登录 |
| GPT API | OpenAI Responses API | Codex CLI 作为代理运行器，单次注入 `CODEX_API_KEY` | `OPENAI_API_KEY`，按 API 用量计费 |
| Claude（兼容） | 原 `claude -p` subscription backend | 原 Claude CLI + Chrome/Playwright | 本机 Claude 登录 |

Codex 是代理运行器，GPT 是模型/API。GPT 模式的浏览器任务仍使用 Codex 运行器，是为了复用同一套 MCP、审批闸门、任务日志和安全协议；模型请求与费用则走用户配置的 API key。

## 覆盖矩阵

- 职位匹配、资格结构化、去重判簇、内推建议
- 简历经历选择与措辞、消息起草/缩短、对话阶段判断
- JD 补正文、后台填表、人脉搜索/发送
- 用户 Chrome 投递、内推回复检查、Chrome 扫描

前两组走 `src/llm`；后两组走 `src/ai/runtime.ts`。二者都从 `profile.ai_provider` 读取同一个全局选择。环境变量 `AI_PROVIDER` 只是在数据库尚无选择时的默认值。

## 安全与回退

- API key 只从服务器进程环境读取；不写数据库、不返回设置页、不进入子进程参数或日志。
- GPT 浏览器任务只给该 Codex 进程设置 `CODEX_API_KEY`，不覆盖本机已有 Codex 登录；Codex 的 shell environment policy 会从模型发起的 shell 命令环境中剥离 `CODEX_API_KEY` / `OPENAI_API_KEY`，避免网页提示注入通过命令读取密钥。只启用可信的本机浏览器插件。
- 提交申请和发送消息的 App 审批闸门不变。
- 现有安装默认仍为 Claude，直到主账号在设置页显式切换；可随时回退。
- GPT 未同时配置 API key 和模型时，设置页显示未配置并拒绝切换。

## 配置

```dotenv
AI_PROVIDER=claude
CODEX_BIN=
CODEX_FAST_MODEL=
CODEX_SMART_MODEL=
CODEX_AGENT_MODEL=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=
OPENAI_FAST_MODEL=
OPENAI_SMART_MODEL=
GPT_AGENT_MODEL=
```

模型名不固化在代码中：OpenAI 模型目录会变化，部署者通过环境变量选定并可独立调整 fast、smart 和 agent 三档。
