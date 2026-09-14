import { defineMessages } from "../define";

// The 「扫描 ▾」 menu (src/app/components/scan-menu.tsx): its two items and the toasts for a
// server-side scan and a queued Chrome scan. The Chrome scan's status comes from labels.runStatus.
export const scan = defineMessages({
  zh: {
    menu: "扫描",
    scanning: "扫描中…",
    scanNow: "立即扫描(核心信息源)",
    chromeScan: "在我的 Chrome 里扫描",
    chromeStatus: (status: string) => `Chrome 扫描:${status}`,
    startedTitle: "正在扫描核心信息源…",
    startedDescription: "通常需要一到三分钟,完成后会提示。",
    doneTitle: (inserted: number) => `扫描完成:新增 ${inserted} 个职位`,
    doneDescription: (upgraded: number, duplicates: number, errors: number) => `${upgraded} 个升级 · ${duplicates} 个重复 · ${errors} 个来源出错`,
    failedTitle: "扫描失败",
    chromeQueuedTitle: "已排队 Chrome 扫描",
    chromeQueuedDescription: "助手接手后会在你的 Chrome 里只读地搜 LinkedIn、Handshake 和 Tesla。",
    chromeQueueFailed: "没排上",
  },
  en: {
    menu: "Scan",
    scanning: "Scanning…",
    scanNow: "Scan now (core sources)",
    chromeScan: "Scan in my Chrome",
    chromeStatus: (status: string) => `Chrome scan: ${status}`,
    startedTitle: "Scanning core sources…",
    startedDescription: "Usually takes one to three minutes; you will be told when it finishes.",
    doneTitle: (inserted: number) => (inserted === 1 ? "Scan finished: 1 new job" : `Scan finished: ${inserted} new jobs`),
    doneDescription: (upgraded: number, duplicates: number, errors: number) =>
      `${upgraded} upgraded · ${duplicates} ${duplicates === 1 ? "duplicate" : "duplicates"} · ${errors} source ${errors === 1 ? "error" : "errors"}`,
    failedTitle: "Scan failed",
    chromeQueuedTitle: "Chrome scan queued",
    chromeQueuedDescription: "Once the assistant picks it up, it searches LinkedIn, Handshake and Tesla in your Chrome, read-only.",
    chromeQueueFailed: "Could not queue it",
  },
});
