import { defineMessages } from "../define";

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Relative and calendar time words (src/app/lib/time.ts). Numeric timestamps stay numeric.
export const time = defineMessages({
  zh: {
    today: "今天",
    yesterday: "昨天",
    daysAgo: (n: number) => `${n} 天前`,
    justNow: "刚刚",
    minutesAgo: (n: number) => `${n} 分钟前`,
    hoursAgo: (n: number) => `${n} 小时前`,
    // "9 月 6 日 · 周日"
    date: (d: Date) => `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${"日一二三四五六"[d.getDay()]}`,
  },
  en: {
    today: "Today",
    yesterday: "Yesterday",
    daysAgo: (n: number) => (n === 1 ? "1 day ago" : `${n} days ago`),
    justNow: "Just now",
    minutesAgo: (n: number) => (n === 1 ? "1 min ago" : `${n} min ago`),
    hoursAgo: (n: number) => (n === 1 ? "1 hour ago" : `${n} hours ago`),
    // "Sep 6 · Sun"
    date: (d: Date) => `${EN_MONTHS[d.getMonth()]} ${d.getDate()} · ${EN_DAYS[d.getDay()]}`,
  },
});
