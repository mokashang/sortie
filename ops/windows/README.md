# Sortie 在 Windows 常开机上的部署与切换 runbook

设计:`docs/superpowers/specs/2026-09-06-windows-server-migration-design.md`。本文是按顺序照做的操作手册。
硬原则:**SQLite 单写者**——第 6 节切换之前 Mac 的服务器照常跑;切换之后 Mac 上绝不再启动它。

## 0. 前提
- Windows 11(x64)、本机管理员;Claude Pro/Max 直连账号;Tailscale 账号;一个 Google 账号(Chrome Remote Desktop)。
- 仓库已推到 GitHub 私有仓(在 Mac 主仓库执行一次:`gh auth login` → `gh repo create sortie --private --source=. --remote=origin --push`)。

## 1. 装软件(管理员 PowerShell)
```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
winget install --id Google.Chrome -e
winget install --id Tailscale.Tailscale -e
winget install --id jqlang.jq -e
winget install --id Microsoft.Sysinternals.Autologon -e
winget install --id oschwartz10612.Poppler -e     # 可选:pdftotext,简历自检用
```
- tectonic:`winget install --id TectonicTypesetting.Tectonic -e`;winget 里找不到就从 GitHub Releases 下载 `tectonic.exe` 放进 PATH 目录(如 `C:\tools`),或 `scoop install tectonic`。
- **新开一个终端**(让 PATH 生效),然后:`npm i -g pm2`、`git config --global core.autocrlf false`、`tzutil /s "Pacific Standard Time"`。
- Claude Code 原生安装:`irm https://claude.ai/install.ps1 | iex`,新终端里 `claude --version` 能出版本;装到 `%USERPROFILE%\.local\bin\claude.exe`。
- Chrome Remote Desktop:在 Windows 的 Chrome 打开 remotedesktop.google.com/access → 设置远程访问 → 装被控端、设 PIN。Mac 上用同一 Google 账号在浏览器里连。
- Claude 桌面 App(可选,开发用)照常安装。
- 可选:OpenSSH 服务端(设置 → 系统 → 可选功能 → 添加「OpenSSH 服务器」,然后 `Set-Service sshd -StartupType Automatic; Start-Service sshd`),Mac 终端经 Tailscale `ssh <用户>@<Tailscale IP>` 做纯命令行的事。

## 2. 仓库与 .env
```powershell
git clone https://github.com/<你的账号>/sortie.git C:\sortie
cd C:\sortie
npm ci
npm test
npm run build
copy .env.example .env
copy profile\profile.example.yaml profile\profile.yaml
```
- `npm ci` 输出里确认 `better-sqlite3` 与 `node-pty` 用了预编译包;若 `node-pty` 编译失败(没有 VS Build Tools),不用管——在 `.env` 里设 `ATTENDED_SPAWN_MODE=console`。
- `.env` 至少填:`NTFY_TOPIC=<长随机串>`;**演练期先加** `SCAN_TICK_DISABLED=1` 和 `ATTENDED_DISPATCH_DISABLED=1`(避免和 Mac 同时扫描、同时烧 `claude -p` 配额)。Mac 生产的 `.env` 从 2026-09-09 起还有 `JD_REVIEW_RELAY_DISABLED=1`(迁移前不让 Mac 再跑补正文);**Windows 的 `.env` 不要抄这一条**,否则补正文永远不自动接力。
- iPhone 装 ntfy app 订阅这个 topic;Mac 浏览器打开 ntfy.sh/app 订阅同名 topic 并允许通知。

## 3. Claude 与 Chrome 一次性准备
1. Chrome 里新建「求职」档案,手动登录 LinkedIn / Workday / Handshake / Google;装 Claude in Chrome 扩展并登录 Claude 账号。`chrome://version` 看 Profile Path 最后一段(如 `Profile 2`),写进 `ops\windows\start-chrome.cmd` 的 `PROFILE=`。
2. 终端:`claude` → `/login`(浏览器 OAuth,选 Pro/Max 账号)。
3. 在 `C:\sortie` 里跑一次 `claude --chrome`:点掉首次介绍框、目录信任框;`/chrome` 应显示 Status: Enabled、Extension: Installed;`/exit`。这样调度器自动拉起的会话不会卡在首次提示上。
4. **不用** `claude mcp add playwright`:无人值守执行器 spawn `claude -p` 时自己内联注册 Playwright MCP(Windows 上走 `cmd /c npx`),只要 `npx` 在 PATH 里;打分等纯文本调用不起任何 MCP。

## 4. 一次性设置、pm2 首启、Tailscale Serve
```powershell
powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1     # 管理员
pm2 start C:\sortie\ops\windows\ecosystem.config.cjs --only sortie
pm2 save
pm2 logs sortie --lines 50          # 应看到 "[jobseeker] scheduler registered"
tailscale up
tailscale serve --bg 3000
tailscale serve status
```
- Tailscale 管理台(login.tailscale.com/admin/dns):开 MagicDNS 和 HTTPS Certificates。Mac(已装 Tailscale)打开 `https://<机名>.<tailnet>.ts.net` 应看到 App。
- 自动登录:运行 Autologon.exe,填当前用户与密码 → Enable(它把密码存为 LSA secret;任何脚本都不碰密码)。
- 重启一次 Windows,确认:自动登录 → `pm2 status` 里 `sortie` online → Chrome 已开 → 网址可达。

## 5. 演练(用数据副本,Mac 不停机)
Mac 上:
```bash
cd /Users/moka/Documents/job_seeker
sqlite3 data/jobseeker.db ".backup 'data/backups/migrate-$(date +%F).db'"
tar czf ~/sortie-migrate.tgz -C data/backups migrate-$(date +%F).db -C /Users/moka/Documents/job_seeker profile/profile.yaml data/resumes
tailscale file cp ~/sortie-migrate.tgz <windows-机名>:
```
Windows 上(Taildrop 文件落在「下载」;CLI 版用 `tailscale file get $env:USERPROFILE\Downloads`):
```powershell
pm2 stop sortie
cd C:\sortie
tar -xzf $env:USERPROFILE\Downloads\sortie-migrate.tgz -C C:\sortie
Move-Item -Force C:\sortie\migrate-*.db C:\sortie\data\jobseeker.db
Remove-Item -ErrorAction SilentlyContinue C:\sortie\data\jobseeker.db-wal, C:\sortie\data\jobseeker.db-shm
pm2 restart sortie --update-env
```
验证:Mac 浏览器过一遍 /queue /apply /history /network /dashboard;/resume 生成一份 PDF(tectonic);/queue 点「补判内推建议」后 `pm2 logs sortie` 没有 "claude CLI not found";`npm run backup` 成功。

## 6. 切换日(约 30 分钟停机)
Mac 上:
```bash
launchctl bootout gui/$(id -u)/com.jobseeker.os
mv ~/Library/LaunchAgents/com.jobseeker.os.plist ~/Documents/job_seeker/data/backups/   # 防止开机自启
pgrep -fl "next start" || echo "mac server stopped"
cd /Users/moka/Documents/job_seeker && sqlite3 data/jobseeker.db ".backup 'data/backups/final-$(date +%F).db'"
tailscale file cp data/backups/final-$(date +%F).db <windows-机名>:
```
Windows 上:`pm2 stop sortie` → 用 `final-*.db` 覆盖 `C:\sortie\data\jobseeker.db`(同上删 -wal/-shm)→ `.env` 去掉 `SCAN_TICK_DISABLED` 与 `ATTENDED_DISPATCH_DISABLED`(也确认没有 `JD_REVIEW_RELAY_DISABLED`)→ `pm2 restart sortie --update-env`。
核对:/queue 漏斗计数与 Mac 最后一次一致;`pm2 logs sortie` 每分钟出现 scan tick;做一个会发通知的动作(如让一次 needs_info 发生,或 `curl -d test https://ntfy.sh/<topic>`)手机与 Mac 都收到。

## 7. 验收清单
- [ ] `npm test` 在 Windows 全绿。
- [ ] ts.net 网址在 Mac 与手机都能开。
- [ ] 匹配分数持续产出(/queue 新岗有分;`matches` 行数增长);/sources 各家族「24h 出错」正常。
- [ ] **核心**:Claude 桌面 App 关着 → App 点「开始投递」→ 10 秒内执行器面板显示 spawn → run 日志出现接单 → Windows Chrome 开始填表 → Mac 上确认 → 提交成功。
- [ ] 重启演练:Windows 重启 → 自动登录 → pm2、Chrome 自动起来 → 网址 2 分钟内恢复。
- [ ] 次日 `C:\sortie\data\backups\` 里出现 `jobseeker-<日期>.db`。

## 8. 阶段 2:自定义域名(随时做,不阻塞以上)
**2026-09-13 已完成**:域名 usesortie.com,网址 `https://usesortie.com`,老网址 ts.net 保留;Caddy 任务与防火墙已注册,Tailscale Serve 已关。下面的步骤保留作重做 / 换域名时的手册。
本机实际仓库路径是 `E:\sortie`(下同)。**机器侧 2026-09-11 已备好**:`C:\caddy\caddy.exe`(2.11.4,caddyserver.com 定制构建,含 `dns.providers.cloudflare` 与 `tls.get_certificate.tailscale`);`ops\windows\Caddyfile` 不用再改,全部从 `.env` 取值(`SORTIE_DOMAIN` / `TS_HOSTNAME` / `TS_IP` / `CF_API_TOKEN`);`.env` 里 `TS_IP`、`TS_HOSTNAME` 已填;`ops\windows\caddy-switch.ps1` 负责预检 / 切换 / 回滚;已用 8443 端口做过真实联调(Caddy 绑 Tailscale IP、ts.net 证书由本机 tailscaled 签、反代 3000 返回 200)。剩下两步只能人做:
1. **买域名**:Cloudflare Registrar(或别处买、DNS 托管到 Cloudflare)。然后 Cloudflare → 该域名 → DNS → Records → Add record:Type `A`,Name `@`(域名本身,2026-09-13 选定 `usesortie.com`,网址就是根域名),IPv4 address = `.env` 里的 `TS_IP`(`100.100.246.31`),**Proxy status 关掉(灰云 DNS only)**,TTL Auto。橙云(代理)会把访问引到 Cloudflare 公网,永远连不到 100.x。
2. **建 API token**:Cloudflare → My Profile → API Tokens → Create Token → Create Custom Token:Permissions 加两行 **Zone · Zone · Read** 和 **Zone · DNS · Edit**;Zone Resources = Include · Specific zone · 你的域名;其余默认。**必须两条权限都有**:caddy-dns/cloudflare 先用 Zone:Read 查 zone id,只给 DNS:Edit(Cloudflare 的「Edit zone DNS」模板)会报 zone could not be found。
3. 用记事本把两样写进 `E:\sortie\.env`(不要贴给任何会话):
   ```
   SORTIE_DOMAIN=usesortie.com
   CF_API_TOKEN=<token>
   ```
4. 预检(只读,不改任何东西;普通 PowerShell 即可):
   ```powershell
   powershell -ExecutionPolicy Bypass -File E:\sortie\ops\windows\caddy-switch.ps1 -Check
   ```
   四个键都有、Caddyfile valid、公共 DNS(1.1.1.1)查到的 A 记录 = `TS_IP` 才算通过;A 记录刚加要等几分钟。
5. 切换(同一条命令去掉 `-Check`;中间弹一次 UAC 给 `setup.ps1 -WithCaddy`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File E:\sortie\ops\windows\caddy-switch.ps1
   ```
   顺序:预检 → 管理员 `setup.ps1 -WithCaddy`(注册「Sortie Caddy」登录任务 + 防火墙只放行 tailnet 来源的 80/443,此时什么都没启动)→ `tailscale serve off` → 启动任务 → 每 5 秒探测 `https://usesortie.com` 与 `https://<TS_HOSTNAME>`,最多 3 分钟(首次签证书约 30–90 秒)。域名没起来就自动回滚:停掉并禁用任务、`tailscale serve --bg 3000`,老网址几秒内恢复,并打印 `data\caddy.log` 末尾。
6. 验证:Mac 与手机(Tailscale 开着)打开 `https://usesortie.com`;老网址 `https://laptop-kvharru8.tailbffe80.ts.net` 也继续可用。日志:`E:\sortie\data\caddy.log`(进程 / 证书)、`data\caddy-access.log`(访问);任务:`Get-ScheduledTaskInfo "Sortie Caddy"`。本机能开、别的设备打不开 → 看防火墙规则 `Get-NetFirewallRule -DisplayName "Sortie Caddy*"`。
7. 回滚(随时):`caddy-switch.ps1 -Rollback` → 停掉并禁用任务、恢复 Tailscale Serve。改过 Caddyfile 或 `.env` 后要重启任务:`Stop-ScheduledTask "Sortie Caddy"; Start-ScheduledTask "Sortie Caddy"`(admin API 关着,没有 reload)。重启机器后任务在登录 25 秒后自动起来;Tailscale 网卡还没好导致绑不上时,每分钟重试一次、最多 3 次。**任务的动作不是 `caddy.exe` 本身,而是 `wscript.exe //B //Nologo ops\windows\run-hidden.js -Retries 3 -RetryDelaySec 60 C:\caddy\caddy.exe run …`**(2026-09-14 起):计划任务直接启动控制台程序会在桌面上留一个空白的「caddy.exe」黑窗口,关掉它就等于杀掉代理(结果码 0xC000013A 就是这么来的);`run-hidden.js`(WSH JScript,GUI 子系统、本身无窗口)隐藏地拉起 `run-hidden.ps1`,后者再隐藏地拉起 Caddy、把退出码原样传回任务、任务被 `Stop-ScheduledTask` 结束时 250 ms 内跟着结束 Caddy(任务调度器只杀任务自己的进程,不杀子进程),并在 Caddy 非零退出时按上面的次数重试(任务设置里的「失败后重启」对非零退出码从不生效,2026-09-14 实测)。进程树 `wscript.exe → powershell.exe → caddy.exe`,三个都没有窗口;`Get-Process caddy` 照常能看到。

## 9. 日常运维
- 部署:`powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\deploy.ps1`(有值守会话在跑会拒绝;确认无事后 `-Force`)。
- 状态/日志:`pm2 status`、`pm2 logs sortie`、`C:\sortie\data\pm2-*.log`、值守会话转录 `C:\sortie\data\executor-logs\attended-<run>.log`。
- 备份:自动每天 04:00;手动 `npm run backup`;每周把最新一份 Taildrop 到 Mac 一次。
- Claude 登录失效(值守会话日志 "extension not connected" / 403):终端 `claude` → `/login`;扩展掉线:`/chrome` → Reconnect extension。
- Windows 更新重启后:看 `pm2 status` 与网址;`tzutil /g` 仍是 Pacific Standard Time。
- 值守会话起不来且日志提到 node-pty:`.env` 设 `ATTENDED_SPAWN_MODE=console`,`pm2 restart sortie --update-env`。

## 10. 回滚(切换后两周内)
Windows `pm2 stop sortie`;把 Windows 最新备份拷回 Mac 的 `data/jobseeker.db`;Mac 把 plist 移回 `~/Library/LaunchAgents/` 并 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobseeker.os.plist`。两周稳定后再清 Mac 的 `data/`(留一份 zip 归档)。

## 11. 账号系统上线(2026-09-13)
部署带账号系统的版本后(`deploy.ps1` 照常),第一次访问 `https://usesortie.com` 会跳到 `/login`。
1. **先在 `.env` 写 `SORTIE_OWNER_EMAIL=<你的邮箱>`**(可选但推荐:保证只有这个邮箱能成为主账号),`pm2 restart sortie --update-env`。
2. 打开 `/signup` 用该邮箱注册。服务器日志出现 `[auth] <邮箱> created — became owner, claimed legacy rows {...}` 即认领完成:队列、历史、人脉、简历、经历原样在;`profile/profile.yaml` 已导入档案页「基本信息」。没配邮件时验证链接在 `E:\sortie\data\outbox\*.txt`(不验证也能用)。
3. 机器内部令牌在 `E:\sortie\data\internal-token`(首次启动自动生成):调度器、`deploy.ps1`、常开机上的桌面值守会话都用它(值守会话按 CLAUDE.md §3 每条 curl 加 `-H "$AUTH"`)。
4. Google 登录(可选):Google Cloud Console → APIs & Services → Credentials → OAuth client ID(Web application),Authorized redirect URI 填 `https://usesortie.com/api/auth/callback/google`(老网址也要用就再加 `https://<TS_HOSTNAME>/api/auth/callback/google`),把 client id/secret 写进 `.env` 的 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,重启。同邮箱的 Google 账号会自动关联到已有账号。
5. 邮件(可选):`SMTP_URL=smtps://<user>:<app-password>@smtp.gmail.com:465`、`MAIL_FROM=Sortie <you@gmail.com>`;配了之后新账号必须验证邮箱才能登录。
6. 关闭注册:`SIGNUP_DISABLED=1`。会话密钥 `data/auth-secret` 自动生成;备份任务已把整个 `data/` 之外的库文件备份,`internal-token` / `auth-secret` 丢了只是要重新登录、重新拿令牌。
