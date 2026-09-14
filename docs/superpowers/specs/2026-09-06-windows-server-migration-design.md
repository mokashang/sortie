# Windows 常开机迁移(服务器搬到 Windows,Mac 只做客户端)设计 — 2026-09-06

## 目标
整套 Sortie 从 MacBook 搬到一台常开的 Windows 11 机器上跑:后端、SQLite、扫描、`claude -p` 打分、值守会话、求职用 Chrome 全在 Windows。Mac 和手机只通过一个 HTTPS 网址使用 App;以后改代码也在 Windows 上做。用户 2026-09-06 拍板:网址只给自己的设备可达(tailnet),要一个自定义域名(域名后买,放 Cloudflare),代码放 GitHub 私有仓,开发搬到 Windows。

## 事实(决定设计的硬约束)
- **Claude Code 的 Chrome 集成官方不支持 WSL**;Windows 原生支持(native messaging host 走注册表,CLI 与 Chrome 必须同机)。→ 服务器必须原生 Windows,不能 WSL、不能 Docker Desktop。
- 值守会话必须是交互式 Claude(桌面 App 或终端 `claude --chrome`),且要碰到**用户桌面会话里**的 Chrome。Windows 服务跑在 session 0,拉不起也看不到这些 → 服务器进程必须跑在用户登录会话里,不能做成 Windows 服务。
- 仓库目前**没有 git remote**;`profile/` 与 `data/` 在 `.gitignore`,永远不进仓库。
- App 没有任何鉴权。UI 全是相对路径、没有 Server Actions → 前面放反代完全透明。
- 代码里绑死 Mac 的只有 6 处:launchd plist(仓库外)、`src/lib/notify.ts` 的 osascript、`src/executor/attended.ts` 的 `expect` 拉起 + 进程组 SIGTERM、`src/executor/runner.ts` 的进程组 SIGTERM、`src/executor/open-profile.ts` 的 Chrome `.app` 路径、`src/lib/claude-bin.ts` 的 `~/.local/bin/claude`。其余(better-sqlite3、Next、tectonic/pdftotext 的 execFile、scripts/)可移植。
- 时间逻辑按进程本地时区:03:xx 重算分级、09/18 点内推回复检查、/apply「今日已提交」按本地 0 点。
- `claude -p` 的 system prompt 经 `--append-system-prompt` 命令行参数传入,Windows 单条命令行上限 32K 字符。已量:四处 system 常量所在文件整体最大 15KB(`src/network/draft.ts`),风险排除;若将来有超长 system 再改文件传入。
- Windows 11 大概率 Home 版:没有 RDP 被控端;Task Scheduler、Autologon、OpenSSH 服务端、ConPTY 都可用。机器按 x64 假设,ARM 机器需另验 better-sqlite3 / node-pty 预编译包。
- 值守会话与三个 skill(`.claude/skills/*`)里写死的 `http://127.0.0.1:3000` 在迁移后仍然正确(它们和服务器同机),不改。

## 设计

### 1. 拓扑与网址
角色:
- **Windows = 服务器 + 操作台**:Sortie 服务器(继续只绑 `127.0.0.1:3000`)、SQLite、扫描器、`claude -p` 打分、求职用 Chrome(装 Claude in Chrome 扩展并登录)、Claude CLI 与 Claude 桌面 App(值守会话与开发)、tectonic/poppler。全部在同一个已登录的 Windows 用户会话里。
- **Mac / iPhone = 纯客户端**:装 Tailscale,浏览器开 App 网址;ntfy 收通知。Mac 上不再跑任何 Sortie 进程。

网址两阶段:
1. **上线当天:Tailscale Serve**。`tailscale serve --bg 3000` 把 `https://<机名>.<tailnet>.ts.net` 转到本机 3000。零入站端口、证书由 Tailscale 自动签、服务器绑定不改。前提:tailnet 管理台开 MagicDNS + HTTPS Certificates。
2. **域名到位后:Caddy**。在 Cloudflare Registrar 买域名;`sortie.<域名>` 的 A 记录指向 Windows 的 Tailscale IP(100.x,**DNS only 灰云**,不走 Cloudflare 代理)。Windows 上跑带 `caddy-dns/cloudflare` 模块的 Caddy,`bind <Tailscale IP>` 只监听 Tailscale 网卡的 443,证书走 Cloudflare **DNS-01** 自动签(API token 只给该域,权限 Zone:Read + Zone:DNS:Edit;caddy-dns/cloudflare 要用 Zone:Read 查 zone id,只给 DNS:Edit 会报 zone 找不到),`reverse_proxy 127.0.0.1:3000`。这时 `tailscale serve off`(两者都要 443)。外人能解析到 100.x 但连不上。可选:Caddy 也监听 ts.net 主机名(它能自动向本机 tailscaled 取证书),让老网址继续可用;不强求。

安全边界:App 不加登录,tailnet 就是围墙(默认 ACL 只有本人设备互通)。Windows 防火墙只给 `caddy.exe` 放行来源 `100.64.0.0/10`。ntfy 话题用长随机名(通知内容只有公司名与状态,低敏)。

### 2. Windows 常驻、开机与开发工作流
目录与软件:
- 仓库放 `C:\sortie`。**不要**放 Documents/Desktop(Win11 默认 OneDrive 同步会锁坏 SQLite)。Defender 排除 `C:\sortie\data`、`C:\sortie\node_modules`。
- 软件:Node 22 LTS、Git for Windows(Claude Code 的 Bash 工具依赖它;`git config --global core.autocrlf false`)、Claude Code 原生安装器(`%USERPROFILE%\.local\bin\claude.exe`,`claude /login`,Pro/Max 直连账号)、Claude 桌面 App、Google Chrome + Claude in Chrome 扩展、Tailscale、jq(值守会话允许工具含 `Bash(jq:*)`,Git Bash 不自带)、tectonic、poppler(可选:缺了只是简历自检跳过)、pm2(`npm i -g pm2`)、Chrome Remote Desktop 被控端、Sysinternals Autologon。Caddy 阶段 2 再装。

常驻方式(**不用 Windows 服务**):
- 开机自动登录(用户自己用 Autologon 工具设置,密码存 LSA secret;任何脚本都不碰密码)→ 重启/更新后桌面会话自动存在。
- 任务计划,触发器「用户登录时」,勾「仅当用户登录时运行」,登录后拉起三样:
  1. `Sortie Server`:`pm2 resurrect`。pm2 应用定义 `ops/windows/ecosystem.config.cjs`:直接跑 `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000`(不经 `npm.cmd` 壳,重启不留僵尸),`cwd=C:\sortie`,`env.TZ=America/Los_Angeles`,日志到 `data/pm2-*.log`,崩溃自动重启。
  2. `Sortie Chrome`:`start-chrome.cmd` 打开求职用 Chrome 档案(扩展在线才能接单)。
  3. `Sortie Caddy`(阶段 2):`caddy run --config ops\windows\Caddyfile --envfile C:\sortie\.env`(`CF_API_TOKEN` 放 `.env`)。
  4. `Sortie Backup`:每天 04:00 `npx tsx scripts/backup-db.ts`。
- Tailscale 本身是系统服务,开机即在。
- 电源:接电永不睡眠、`powercfg /hibernate off`、关快速启动(`HiberbootEnabled=0`)、合盖不动作。Windows Update 设活动时段;偶尔的自动重启由自动登录 + 登录任务自愈。
- 时区:系统设太平洋时间,且 pm2 环境钉死 `TZ=America/Los_Angeles`。

部署:`ops/windows/deploy.ps1` 取代 `npm run build && launchctl kickstart`:
1. 守卫:`GET /api/executor/dispatch` 的 `spawn.alive` 为真,或 `GET /api/executor/status` 里有 `channel=user_chrome` 且 `status=running` 的 run → 拒绝并提示(重启服务器会连带杀掉它用 ConPTY 拉起的 claude 子进程),`-Force` 可跳过;
2. `git pull --ff-only` → `npm ci` → `npm run build` → `pm2 restart sortie` → 等 `/api/executor/status` 返回 200 后打印版本(最新 commit)。
构建失败则不重启(与 Mac 上现状一致:`.next` 可能已被写坏,需再跑一次成功的 build)。

开发与远程桌面:
- Mac 用 Chrome Remote Desktop 连 Windows 桌面(Home 版可用,断开后会话保持,Chrome 与值守会话继续跑)。在 Windows 的 Claude 桌面 App Code 标签或 Windows Terminal 里跑 Claude Code,照旧开分支、合 main,然后跑 `deploy.ps1`。GitHub 私有仓是 `origin`,是唯一真相。
- 可选:开 Windows 自带 OpenSSH 服务端(只经 Tailscale 可达),Mac 终端 ssh 进去做纯命令行的事。
- 涉及值守会话/Chrome 的功能只能在 Windows 上真机验证。

Chrome 一次性准备:新建求职档案,手动登录 LinkedIn / Workday / Handshake / Google;装 Claude in Chrome 扩展并登录 Claude 账号;在 `C:\sortie` 里手动跑一次 `claude --chrome`,点掉首次介绍框与目录信任框,`/chrome` 确认 Status: Enabled / Extension: Installed。这样服务器自动拉起的会话永远不会卡在首次提示上。`data/browser-profile`(579MB 无头档案)不迁移;以后真要用无头通道再重新登录。

### 3. 代码改动(同一份代码,运行时按 `process.platform` 分支;Mac 路径原样保留)
| 文件 | 改什么 |
|---|---|
| `src/lib/notify.ts` | osascript 只在 `darwin` 调用;非 darwin 且没配 `NTFY_TOPIC` 时警告一次(进程级)。`opts.platform` 可注入。 |
| `src/executor/attended.ts` | argv 组装抽成纯函数 `buildAttendedArgs({runId, prompt, sessionName})`,expect 脚本与 Windows 路径共用同一份 argv。win32 用 **node-pty**(ConPTY)拉起 `claude.exe`:`cols 200/rows 50`,`onData` 追加到 `attended-<run>.log`,匹配 `/Enter to confirm|Press Enter to continue/i` 时写 `\r`(等价现有 expect),返回 pid。回收:win32 `taskkill /pid <pid> /t /f`,其余平台维持进程组 SIGTERM。`ATTENDED_SPAWN_MODE=console` 兜底:`spawn(claudeBin, args, {detached:true, stdio:'ignore', windowsHide:false})` 开独立控制台窗口,无自动回车、无转录(node-pty 装不上时用)。依赖注入:`spawnExpect`(现有)+ `spawnPty` + `platform`,测试不碰真进程。deploy 守卫读 `GET /api/executor/dispatch` 的 `spawn.alive` 与 `GET /api/executor/status` 的 runs。 |
| `src/executor/runner.ts` | `stopExecutor` 的进程组杀在 win32 改 `taskkill /t /f`;其余不动。 |
| `src/lib/claude-bin.ts` | 候选顺序:`CLAUDE_BIN` → `~/.local/bin/claude` → (win32) `~/.local/bin/claude.exe` → 裸 `claude`。 |
| `src/executor/open-profile.ts` | `CHROME_BIN` 优先;win32 默认探 `%ProgramFiles%\Google\Chrome\Application\chrome.exe`、`%ProgramFiles(x86)%\…`、`%LocalAppData%\Google\Chrome\Application\chrome.exe`,都没有则 `cmd /c start "" chrome …`;darwin 逻辑不变;linux `google-chrome`。 |
| `src/resume/pdf-text.ts` | `PDFTOTEXT_BIN` 环境变量,与 `TECTONIC_BIN` 对称。 |
| `scripts/backup-db.ts` | better-sqlite3 在线 `db.backup()` 到 `data/backups/jobseeker-<YYYY-MM-DD>.db`,保留 14 天,打印结果。 |
| `ops/windows/setup.ps1` | 幂等:注册上述四个任务计划(缺则建、有则更新)、防火墙规则 `Sortie Caddy (tailnet only)`、Defender 排除、电源设置;打印每项做了什么。**不**设置自动登录、**不**碰任何密码。 |
| `ops/windows/deploy.ps1`、`ecosystem.config.cjs`、`start-chrome.cmd`、`Caddyfile` | 见第 2 节。Caddyfile 为模板:域名占位、`bind {$TS_IP}`、`tls { dns cloudflare {env.CF_API_TOKEN} }`。 |
| `.env.example` | 新键 `CHROME_BIN`、`PDFTOTEXT_BIN`、`ATTENDED_SPAWN_MODE`、`CF_API_TOKEN`、`TS_IP`;注明非 Mac 上 `NTFY_TOPIC` 是唯一通知通道。 |
| `package.json` | `node-pty` 进 `optionalDependencies`(装失败不阻塞 `npm ci`;win32 路径缺它时抛清楚的错并提示 console 模式);`engines.node >= 22`。 |
| `.gitattributes` | `* text=auto eol=lf`,防 Windows 上开发产生 CRLF 污染。 |
| README / CLAUDE.md | README 加「Windows 部署」节;CLAUDE.md §2 部署命令换 `deploy.ps1`、§3 注明值守会话只在 Windows(Mac 上新会话不要再跑心跳 Monitor)、§4.4 标记完成并指向本 spec。 |

不改:服务器绑定与端口、`instrumentation.ts`、skills 里的 URL、扫描/匹配/去重/UI、headless 通道的 Playwright 注册方式。

### 4. 数据迁移、切换、验收与回滚
硬原则:**SQLite 单写者**。任何时刻只有一台机器的服务器在写库;切换后 Mac 上绝不再启动服务器。

1. **准备(Mac 不停机)**:建 GitHub 私有仓并 push main;Windows 装齐第 2 节软件;Chrome 求职档案登录;`claude /login` 并手动跑一次 `claude --chrome`;Tailscale 上线并 `serve`;`git clone` 到 `C:\sortie`,`npm ci`、`npm test`、`npm run build`;写 `.env`(新起长随机 `NTFY_TOPIC`;iPhone 装 ntfy app 订阅,Mac 浏览器开 ntfy 网页版订阅并允许通知);跑 `setup.ps1`。
2. **演练(用副本)**:Mac 上 `sqlite3 data/jobseeker.db ".backup 'data/backups/migrate-<日期>.db'"` 做一致快照(服务器不用停),连同 `profile/profile.yaml`、`data/resumes/` 打包,`tailscale file cp` 传到 Windows,放到 `C:\sortie\data\jobseeker.db` 与 `C:\sortie\profile\`。Windows `.env` 先加 `SCAN_TICK_DISABLED=1`、`ATTENDED_DISPATCH_DISABLED=1`(避免两台机器同时扫描、同时烧 `claude -p` 配额),`pm2 start`;从 Mac 浏览器开 ts.net 网址过一遍各页;生成一份简历(tectonic);跑一次单岗打分验证服务器进程能调 claude。
3. **切换日(约 30 分钟停机)**:Mac `launchctl bootout gui/$(id -u)/com.jobseeker.os` 并把 plist 移出 `~/Library/LaunchAgents`;再做一次最终 `.backup` 传过去覆盖;Windows 去掉两个禁用开关,`pm2 restart sortie`;核对 /queue 漏斗计数与 Mac 最后数字一致、pm2 日志每分钟出现 scan tick、ntfy 收到一条通知(用 `POST /api/apply/report` 的 needs_info 路径或任一会发通知的动作触发)。
4. **验收清单**:
   - 单测:`npm test` 在 Mac 与 Windows 都全绿(新增:notify 平台门;`buildAttendedArgs` 两路一致;win32 走注入的 `spawnPty`/`taskkill`;console 模式 argv;open-profile 的 win32 路径与 `CHROME_BIN`;claude-bin 的 `.exe` 候选;backup 脚本保留策略)。
   - ts.net 网址在 Mac 与手机都能开;匹配分数在 Windows 上持续产出(`matches` 增长);/sources 各家族「24h 出错」正常。
   - **核心一条**:桌面 App 关着时在 App 点「开始投递」→ 10 秒内执行器面板显示 spawn → run 日志出现接单 → Windows Chrome 开始填表 → Mac 上确认 → 提交成功。
   - 重启演练:Windows 重启 → 自动登录 → pm2、Chrome 自动起来 → 网址 2 分钟内恢复。
   - 次日 `data/backups/` 出现自动备份文件。
5. **阶段 2(域名,随时做,不阻塞以上)**:Cloudflare 买域名 → A 记录指 Tailscale IP(灰云)→ 只给该域、权限 Zone:Read + DNS:Edit 的 API token 写进 `.env` → 下载带 cloudflare 模块的 Caddy → 填 Caddyfile → `setup.ps1` 注册 `Sortie Caddy` → `tailscale serve off` → 验证 `https://sortie.<域名>`。

回滚:切换后两周内 Mac 的仓库与 `data/` 原样保留(只是服务卸载)。出问题:Windows `pm2 stop sortie`,把 Windows 最新备份拷回 Mac,`launchctl bootstrap` 装回服务。两周稳定后清 Mac 的 `data/`,留一份 zip 归档。

## 不做
- 不给 App 加登录;不做 Cloudflare Tunnel / Access(备选,以后想在别人设备上开 App 再加,与本设计不冲突)。
- 不做两套代码/两个版本;不做 WSL/Docker。
- 不迁移 `data/browser-profile`;不改 headless 通道逻辑。
- 不做 git 轮询自动部署(部署是显式的 `deploy.ps1`)。
- 不把 Mac 留作热备(单写者;Mac 只是两周内的冷回滚)。

## 决定与理由(速查)
- pm2 + 登录任务而非 Windows 服务:服务在 session 0 碰不到 Chrome,也没法拉起交互式 claude。
- node-pty 而非纯控制台窗口:保留 expect 的两项能力(自动回车过首次提示、转录日志),代价是一个原生模块;装不上有 console 兜底。
- 先 Serve 后 Caddy:域名未买不阻塞上线;Caddy 只为自定义域名与自签流程,Serve 一条命令零维护。
- 自动登录由用户手工用 Autologon 设置:红线是任何脚本不碰密码。
