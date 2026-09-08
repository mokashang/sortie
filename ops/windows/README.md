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
- `.env` 至少填:`NTFY_TOPIC=<长随机串>`;**演练期先加** `SCAN_TICK_DISABLED=1` 和 `ATTENDED_DISPATCH_DISABLED=1`(避免和 Mac 同时扫描、同时烧 `claude -p` 配额)。
- iPhone 装 ntfy app 订阅这个 topic;Mac 浏览器打开 ntfy.sh/app 订阅同名 topic 并允许通知。

## 3. Claude 与 Chrome 一次性准备
1. Chrome 里新建「求职」档案,手动登录 LinkedIn / Workday / Handshake / Google;装 Claude in Chrome 扩展并登录 Claude 账号。`chrome://version` 看 Profile Path 最后一段(如 `Profile 2`),写进 `ops\windows\start-chrome.cmd` 的 `PROFILE=`。
2. 终端:`claude` → `/login`(浏览器 OAuth,选 Pro/Max 账号)。
3. 在 `C:\sortie` 里跑一次 `claude --chrome`:点掉首次介绍框、目录信任框;`/chrome` 应显示 Status: Enabled、Extension: Installed;`/exit`。这样调度器自动拉起的会话不会卡在首次提示上。

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
Windows 上:`pm2 stop sortie` → 用 `final-*.db` 覆盖 `C:\sortie\data\jobseeker.db`(同上删 -wal/-shm)→ `.env` 去掉 `SCAN_TICK_DISABLED` 与 `ATTENDED_DISPATCH_DISABLED` → `pm2 restart sortie --update-env`。
核对:/queue 漏斗计数与 Mac 最后一次一致;`pm2 logs sortie` 每分钟出现 scan tick;做一个会发通知的动作(如让一次 needs_info 发生,或 `curl -d test https://ntfy.sh/<topic>`)手机与 Mac 都收到。

## 7. 验收清单
- [ ] `npm test` 在 Windows 全绿。
- [ ] ts.net 网址在 Mac 与手机都能开。
- [ ] 匹配分数持续产出(/queue 新岗有分;`matches` 行数增长);/sources 各家族「24h 出错」正常。
- [ ] **核心**:Claude 桌面 App 关着 → App 点「开始投递」→ 10 秒内执行器面板显示 spawn → run 日志出现接单 → Windows Chrome 开始填表 → Mac 上确认 → 提交成功。
- [ ] 重启演练:Windows 重启 → 自动登录 → pm2、Chrome 自动起来 → 网址 2 分钟内恢复。
- [ ] 次日 `C:\sortie\data\backups\` 里出现 `jobseeker-<日期>.db`。

## 8. 阶段 2:自定义域名(随时做,不阻塞以上)
1. Cloudflare Registrar 买域名。DNS 加 A 记录:`sortie` → `tailscale ip -4` 的地址,**Proxy status = DNS only(灰云)**。
2. Cloudflare → My Profile → API Tokens → Create Token → 模板 "Edit zone DNS",只勾这一个 zone。写入 `.env`:`CF_API_TOKEN=<token>`、`TS_IP=<100.x.x.x>`。
3. caddyserver.com/download:平台 windows/amd64,勾插件 `dns.providers.cloudflare`,下载到 `C:\caddy\caddy.exe`。
4. 把 `ops\windows\Caddyfile` 里的 `sortie.example.com` 改成你的域名;`C:\caddy\caddy.exe validate --config C:\sortie\ops\windows\Caddyfile --envfile C:\sortie\.env` 通过。
5. `tailscale serve off`(443 让给 Caddy)→ 管理员:`powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1 -WithCaddy -CaddyExe C:\caddy\caddy.exe` → `Start-ScheduledTask "Sortie Caddy"`。
6. Mac 打开 `https://sortie.<域名>`。首次签证书要几十秒;看 `C:\sortie\data\caddy-access.log` 与 `Get-ScheduledTaskInfo "Sortie Caddy"`。

## 9. 日常运维
- 部署:`powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\deploy.ps1`(有值守会话在跑会拒绝;确认无事后 `-Force`)。
- 状态/日志:`pm2 status`、`pm2 logs sortie`、`C:\sortie\data\pm2-*.log`、值守会话转录 `C:\sortie\data\executor-logs\attended-<run>.log`。
- 备份:自动每天 04:00;手动 `npm run backup`;每周把最新一份 Taildrop 到 Mac 一次。
- Claude 登录失效(值守会话日志 "extension not connected" / 403):终端 `claude` → `/login`;扩展掉线:`/chrome` → Reconnect extension。
- Windows 更新重启后:看 `pm2 status` 与网址;`tzutil /g` 仍是 Pacific Standard Time。
- 值守会话起不来且日志提到 node-pty:`.env` 设 `ATTENDED_SPAWN_MODE=console`,`pm2 restart sortie --update-env`。

## 10. 回滚(切换后两周内)
Windows `pm2 stop sortie`;把 Windows 最新备份拷回 Mac 的 `data/jobseeker.db`;Mac 把 plist 移回 `~/Library/LaunchAgents/` 并 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobseeker.os.plist`。两周稳定后再清 Mac 的 `data/`(留一份 zip 归档)。
