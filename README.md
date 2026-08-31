# JobSeeker OS

本地求职作战系统(Phase A:个人版)。spec 见 `docs/superpowers/specs/2026-08-30-jobseeker-os-design.md`。

## 启动
1. `npm install`
2. `cp profile/profile.example.yaml profile/profile.yaml` 并填写(已有真实档案则跳过)。注意:Plan 1 目前只有测试代码读取 `profile.yaml`——扫描器/API/页面还不消费它;它是后续计划(匹配、评分、投递)的输入,现在配置好可以少一步。
3. `cp .env.example .env`,配置 `NTFY_TOPIC`(手机装 ntfy app 订阅同名频道)。**不配置 `NTFY_TOPIC` 不会报错**——`notify()` 会静默跳过 ntfy 推送,只弹 macOS 本机通知,手机端就收不到扫描完成提醒。
4. `npm run dev` → http://127.0.0.1:3000

日常使用也可以用生产模式:`npm run build && npm start`(同样监听 127.0.0.1:3000,行为与 `dev` 一致,但没有热更新开销,适合常驻后台跑扫描)。

## 自动扫描
`src/instrumentation.ts` 在 dev/start 进程启动时注册一个零依赖的进程内定时器(每 30 秒检查一次系统时间,命中 07:00 / 13:00 整点触发,同一小时不重复);触发时对本机 `/api/scan?trigger=cron` 发起 POST,复用与手动扫描相同的 `runScan` 逻辑。只有当这次扫描确实插入了**新**职位(`inserted > 0`)才会发通知——职位升级(已有记录补全 JD/签证信息)不算新机会,不会触发通知,避免每天误报。
这个定时器不依赖任何第三方 cron 库,也不在自身模块图里引入 `better-sqlite3` ——这样 `npm run dev` 的 webpack 才不会因为要为 edge runtime 静态打包原生模块而报 `Can't resolve 'fs'`。
手动:UI"立即扫描"按钮(不带 `trigger` 参数,不触发通知)或 `npm run scan`。

## 数据
- SQLite:`data/jobseeker.db`(gitignored)
- 个人档案:`profile/profile.yaml`(gitignored)
- watchlist 种子:`config/watchlist.seed.json`

## 测试
`npm test`
