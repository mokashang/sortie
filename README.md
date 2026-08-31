# JobSeeker OS

本地求职作战系统(Phase A:个人版)。spec 见 `docs/superpowers/specs/2026-08-30-jobseeker-os-design.md`。

## 启动
1. `npm install`
2. `cp profile/profile.example.yaml profile/profile.yaml` 并填写(已有真实档案则跳过)
3. `cp .env.example .env`,配置 `NTFY_TOPIC`(手机装 ntfy app 订阅同名频道)
4. `npm run dev` → http://127.0.0.1:3000

## 自动扫描
dev/start 进程内置 cron:每天 07:00 与 13:00 扫描 GitHub 清单 + watchlist 公司 ATS API。
手动:UI"立即扫描"按钮或 `npm run scan`。

## 数据
- SQLite:`data/jobseeker.db`(gitignored)
- 个人档案:`profile/profile.yaml`(gitignored)
- watchlist 种子:`config/watchlist.seed.json`

## 测试
`npm test`
