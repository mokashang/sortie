# 投递任务并行(2026-09-30)

## 问题

用户:「我在开着一个投递任务的时候无法开始另一个新的投递任务」。追问后明确要的是**两个一起做**,不是排队、也不是并进当前任务。

原因有两层:

1. 投递页「本次投递计划」在有投递任务 queued / running 时把步进器和「开始投递」整个禁用;`startExecutor` 对同账号同 kind 同通道的第二个 run 直接抛错。一条接力链要做几个小时(70 份 = 7 段,中间还会因为待确认积压暂停),这段时间里什么都开不了。
2. 更根本的:调度器只认**一个**拉起的会话(`profile.attended_spawn` 一条记录),所有 `[Sortie] …` 消息都打进那唯一的终端;取件时按「账号下最新一个 running 的投递任务」记账(`currentApplyRunId`)。就算放开第一层,第二个任务也只能排在第一个后面。

## 设计

### 多个会话

- 调度器最多同时留 `N` 个拉起的会话:设置页「同时进行的任务」1 / 2 / 3,默认 2,存 `profile.attended_parallel`,只有主账号能改(调度器只服务主账号的 Chrome)。选 1 等于旧行为。
- 会话记录改成数组 `profile.attended_spawns`;读到旧的单条 `attended_spawn` 当作一条,下次写入时迁移。
- 每个会话一次只做一个 run。每跳(`planDispatch`,纯函数):
  1. 死了的回收;握不住终端的(服务器重启过):手上还有自己的 run 就让它做完,有已批准的表单在它标签页里、或者有排队的工作而它闲着、或者空闲满 15 分钟,才回收;
  2. 自己的 run 10 分钟没日志的,打提醒;
  3. 排队的 run 按 id 依次找接手的:刚拉起、5 分钟内还没领过 run 的会话算接下一个(它自己会 claim);两分钟内已经告诉过某个还活着的会话的,算有人管;否则告诉一个手上没 run 的会话;都没有就在名额内拉起新会话;
  4. 这一跳回收过会话就不拉起(下一跳再说),桌面会话有心跳时不拉起。

### 归属:每条消息只给负责的那个会话

`src/executor/sessions.ts`:

- 会话靠运行令牌认出来(拉起时为某个 run 签发,`actor.runId` = 那个 run)。
- `claim-next` 把领取会话的 pid 写进 `executor_runs.pid`(user_chrome 行以前一直是 NULL;headless 行这一列本来就是「在做这个 run 的进程」,语义一致)。会话手上还有 running 的 run 时 claim-next 返回 null。
- run 的主人 = pid 相同且领取时间晚于会话启动的那个会话;没有 pid 的老行(桌面会话领的、上线前领的)归「领取时最新的那个会话」——即旧的单会话规则。
- 申请的主人 = `applications.run_id` 那个 run 的主人。
- 取件 `/api/apply/next` 用 `callerApplyRunId`:会话自己正在做的 run,没有就是它最近做过的那个(它在 run 结束后重开自己的标签页时仍归它);headless 令牌就是它自己的 run;其余(桌面会话)照旧取最新 running。

于是:批准 / 退回、答完题、停止、卡住提醒都只打进主人的终端(`notifyJobSession` / `notifyRunSession`);`askerCanContinue`、`reclaimStrandedPrepared`、`requeueStrandedApprovals` 都按「这一行的主人还能不能被叫到」逐行判断;空闲判断、会话死亡时的收尾(把 running 的 run 标 failed、接力续上)都只看自己的 run 和表单。

### 防重复

- 恢复阶段:`GET /api/apply/pending` 对会话调用者只列它自己的、或主人已经叫不到的待确认表单(`heldByOtherSession`)——否则另一个会话会把别人标签页里已批准的表单重填一遍,要么让用户再确认一次,要么和主人同时提交。
- 内推消息:`GET /api/network/sendables` 对会话调用者按行租 30 分钟(`src/network/send-lease.ts`,`profile.outreach_leases`),主人叫不到或租期过了才转给别人——两个接力段同时开始时恢复阶段会走同一份清单,可能在任何一方回报 sent 之前给同一个人发两次。

### 接力与开始

- 用户在 Chrome 通道开投递计划:`startExecutor(..., { queueBehind: true })`,不再拒绝,也不再取代暂停中的接力。
- 接力下一段:Chrome 通道不再因为「别的投递任务在跑」而暂停,直接排队(积压 ≥10 仍然暂停);确认降到 ≤5 份时所有暂停的接力一起转 queued。
- 后台浏览器(headless)只有一个浏览器档案,仍然一次一个。

### 界面

- 投递计划卡:Chrome 通道下有任务时按钮变成「再开一个任务」;提示根据当前占用说「和正在做的任务同时进行」或「已经有 N 个在做,先排队」。
- 助手卡:领头的是正在做的任务(running 先于 queued),下面列出同时进行的其他任务,各自「步骤」「停止」;顶栏胶囊在多个任务时显示「助手 · N 个任务同时进行」。
- 设置页「同时进行的任务」分段控件(仅主账号)。
- `GET /api/executor/dispatch` 返回 `spawns`(全部会话)+ `spawn`(最新一个,兼容);deploy.ps1 逐个打印占用。

## 已知风险

- **两个 Claude in Chrome 会话同时操作同一个 Chrome 还没在真机上验证过。** 每个会话只看得到自己的标签组(此前实测),所以设计上互不干扰;但截图 / 激活标签页 / 文件选择框这类动作会不会互相抢焦点,要上线后开两个小计划看一遍。不行就把设置改回 1。
- 两个会话同时找内推会在 LinkedIn 上并发操作;每个 run 的好友申请 / 私信上限不变,合计会翻倍。
- 开得越多,AI 额度消耗越快。
