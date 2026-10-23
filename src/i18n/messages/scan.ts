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
    startedTitle: "已在后台扫描核心信息源",
    startedDescription: "要十几分钟,不用等在这里;新职位打完分会自动出现在「职位」里。平时后台每分钟都在自动扫,不点也行。",
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
    startedTitle: "Scanning core sources in the background",
    startedDescription: "It takes ten minutes or more; no need to wait here. New jobs show up under Jobs once they're scored. Sources are scanned automatically every minute anyway.",
    failedTitle: "Scan failed",
    chromeQueuedTitle: "Chrome scan queued",
    chromeQueuedDescription: "Once the assistant picks it up, it searches LinkedIn, Handshake and Tesla in your Chrome, read-only.",
    chromeQueueFailed: "Could not queue it",
  },
});
