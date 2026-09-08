# 值守会话调度器(attended dispatcher)设计 — 2026-09-06

## 问题
「用我的 Chrome」通道依赖一个开着的交互式 Claude 会话在轮询 `claim-next`。桌面 App 一关,点「开始投递」就没人接单。用户要求:点击后由**服务器后台**唤醒一个 Claude 会话来接手,仍然用用户自己的 Chrome(不要无人值守的专属档案)。

## 事实
- claude-in-chrome 扩展只连交互式会话;`claude -p` 不行。终端版 `claude --chrome` 是交互式的,能连扩展。
- 扩展与 CLI 之间经 `wss://bridge.claudeusercontent.com` 桥接,需要 CLI 以 `/login` 的 OAuth 登录(带 profile scope)。2026-09-06 探针:`~/.local/bin/claude` 未登录 → 桥接 403;登录后再验。
- 首次 `--chrome` 有一个"Enter 确认"说明框;`--permission-mode dontAsk` + `--allowedTools` 让会话在无人在场时不卡在权限提示;`expect` 提供伪终端(macOS 自带,无需 tmux)。

## 设计
1. **心跳**:任何值守会话每 ≤10s `POST /api/executor/heartbeat {sessionId, kind:'desktop'|'cli'}`;App 存在 `profile` 表键 `attended_heartbeat`(JSON,无需迁移)。
2. **调度 tick**:`src/instrumentation.ts` 每 10s `POST /api/executor/dispatch`。逻辑(纯函数 `decide()`,可测):
   - 有 `channel=user_chrome, status=queued` 的 run;且
   - 最近心跳 > 30s(没有活着的值守会话);且
   - 没有调度器自己拉起、仍活着的 CLI 子进程(键 `attended_spawn` {pid, runId, startedAt})
   → 拉起一个 CLI 会话处理该 run。
   - 回收:子进程已死,或其 run 已终态超过 60s,或存活超过 3h → SIGTERM 进程组并清键。
3. **拉起方式**:写 `data/executor-logs/attended-<runId>.exp`,`spawn expect -f`(detached,stdout → `attended-<runId>.log`)。expect 内 `spawn claude --chrome --permission-mode dontAsk --allowedTools … -n sortie-run-<id> "<prompt>"`,自动对"Enter to confirm"按回车,然后 `expect eof`(超时 3h)。
4. **提示词**:指明"你是 App 调度器拉起的值守会话",先 ToolSearch 加载 claude-in-chrome 工具与 `apply-executor`/`scan-executor`/`network-executor` skill,按 CLAUDE.md §3 用 `GET /api/executor/claim-next?channel=user_chrome` 接单(可能不止一条),全部处理完 `POST finish` 后停止。扩展没连上(list_connected_browsers 为空)→ 立即 `finish failed` 并写明"CLI 未登录或 Chrome 未开",不要空转。
5. **桌面 App 会话优先**:有心跳就不拉起(避免两个会话抢单、浪费 token);claim-next 本身原子,即使并发也不会重复接单。
6. **失败可见**:拉起/回收都写 `console` 与 run 日志;`/api/executor/status` 附带 `attended:{heartbeatAgeSec, spawn}` 供面板显示"调度器状态"。

## 不做
- 不做无人值守档案切换;不做 tmux 常驻;不改 headless 通道。
- Windows 常开机迁移时,把 expect 换成 Windows 等价物(ConPTY/`winpty`),其余不变。

## 验收
- 单测:decide() 矩阵、心跳读写、spawn 记录/回收(注入假 spawn/kill/isAlive)。
- 真机:CLI `/login` 后,退出桌面 App → 点「开始投递」→ 10s 内 status 显示 spawn → run 日志出现"值守会话已接单(CLI)"→ 在用户 Chrome 里填表。
