import { defineMessages } from "../define";

// ⌘K (src/app/components/command-palette.tsx): group names, the action rows and their hints, the
// search field and the footer key legend. Page names come from nav, theme names from shell.themes,
// 打开 / 关闭 / 搜索 from common.
export const palette = defineMessages({
  zh: {
    groups: { pages: "页面", actions: "动作", jobs: "职位" },
    startApply: "开始一次投递",
    startApplyHint: "投递页",
    queueTop: "看职位队列前排",
    queueTopHint: "职位页",
    switchTheme: (current: string) => `切换外观 · 现在是${current}`,
    switchLanguage: (current: string) => `切换语言 · 现在是${current}`,
    // Words a typed query may contain and still list the actions (matched as a substring).
    actionKeywords: "投递扫描外观队列语言",
    scoreHint: (score: number, direction: string | null) => `${score} 分${direction ? ` · ${direction}` : ""}`,
    unscored: "未打分",
    placeholder: "搜公司、职位,或输入要去的页面…",
    noMatch: "没有匹配的职位或页面。",
    typeToStart: "输入关键词开始。",
    select: "选择",
  },
  en: {
    groups: { pages: "Pages", actions: "Actions", jobs: "Jobs" },
    startApply: "Start applying",
    startApplyHint: "Apply page",
    queueTop: "See the top of the job queue",
    queueTopHint: "Jobs page",
    switchTheme: (current: string) => `Switch appearance · now ${current}`,
    switchLanguage: (current: string) => `Switch language · now ${current}`,
    // Words a typed query may contain and still list the actions (matched as a substring).
    actionKeywords: "apply scan appearance theme queue jobs language",
    scoreHint: (score: number, direction: string | null) => `${score} pts${direction ? ` · ${direction}` : ""}`,
    unscored: "Not scored",
    placeholder: "Search companies, jobs, or type a page…",
    noMatch: "No matching jobs or pages.",
    typeToStart: "Type to start.",
    select: "Select",
  },
});
