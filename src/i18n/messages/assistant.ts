import { defineMessages } from "../define";

// The assistant card (status head, queued / running body, the task history table), its 查看步骤
// dialog and the top-bar pill (src/app/components/assistant-card.tsx). Task kinds, statuses and
// channels come from labels; 助手 / 停止 come from common.
export const assistant = defineMessages({
  zh: {
    idle: "空闲",
    viewSteps: "查看步骤",
    stoppedTask: (id: number) => `已停止任务 #${id}`,
    stopFailed: "停止失败",
    queued: (channel: string) => `已排队 · ${channel}操作,助手接手后开始`,
    queuedChromeNote: " · 桌面应用里的会话在线时由它接手,否则 App 自动拉起一个",
    lastStep: "最近一步",
    waitingFirstStep: "已开始,等待第一步…",
    // "开始于 <2 分钟前> · 任务 #12"
    startedPrefix: "开始于 ",
    taskRef: (id: number) => `任务 #${id}`,
    // "上次:投递 · 已完成 · <3 小时前>"
    lastPrefix: "上次:",
    noTasksYet: "还没有执行过任务。",
    history: (n: number) => `任务记录(最近 ${n} 次)`,
    columns: { kind: "类型", details: "内容", status: "状态", started: "开始", ended: "结束", result: "结果" },
    steps: "步骤",
    stopDialog: {
      title: "停止这个任务?",
      description: "助手会在当前步骤停下;已经填好、还没提交的申请会留在待确认里。",
    },
    expand: "展开全文",
    collapse: "收起",
    stepsTitle: (id: number, kind: string) => `任务 #${id} · ${kind}`,
    noLogYet: "还没有记录。",
    pillLive: (kind: string, status: string) => `助手 · ${kind} · ${status}`,
    pillIdle: "助手空闲",
  },
  en: {
    idle: "Idle",
    viewSteps: "View steps",
    stoppedTask: (id: number) => `Stopped task #${id}`,
    stopFailed: "Could not stop it",
    queued: (channel: string) => `Queued · ${channel} · starts once the assistant picks it up`,
    queuedChromeNote: " · a session in the desktop app takes it when online; otherwise the app starts one",
    lastStep: "Latest step",
    waitingFirstStep: "Started, waiting for the first step…",
    // "Started <2 min ago> · task #12"
    startedPrefix: "Started ",
    taskRef: (id: number) => `task #${id}`,
    // "Last: Apply · Done · <3 hours ago>"
    lastPrefix: "Last: ",
    noTasksYet: "No tasks have run yet.",
    history: (n: number) => (n === 1 ? "Task history (1 task)" : `Task history (last ${n} tasks)`),
    columns: { kind: "Type", details: "Details", status: "Status", started: "Started", ended: "Ended", result: "Result" },
    steps: "Steps",
    stopDialog: {
      title: "Stop this task?",
      description: "The assistant stops at its current step; applications already filled in but not submitted stay in To confirm.",
    },
    expand: "Show all",
    collapse: "Show less",
    stepsTitle: (id: number, kind: string) => `Task #${id} · ${kind}`,
    noLogYet: "Nothing logged yet.",
    pillLive: (kind: string, status: string) => `Assistant · ${kind} · ${status}`,
    pillIdle: "Assistant idle",
  },
});
