import { defineMessages } from "../define";

// 信息源 — the advanced page reached from 设置 (src/app/sources/*): the family summary, the board
// table with its filters and per-row actions, and the tier-change log. The page title is nav.sources;
// 全部 comes from common.
export const sources = defineMessages({
  zh: {
    subtitle: "后台每分钟检查一次哪些板块到期:核心每小时、长尾每天、休眠每周。这里用于排查,平时不用看。",
    tiers: { core: "核心 · 每小时", longtail: "长尾 · 每天", dormant: "休眠 · 每周", muted: "静音" },
    origins: { seed: "种子", directory: "目录", url: "链接发现", builtin: "内置" },
    loadFailed: "加载失败",
    actions: {
      retier: { done: "改层级完成", failed: "改层级失败" },
      import: { label: "导入开源目录", done: "导入开源目录完成", failed: "导入开源目录失败" },
      poll: { label: "问一次", done: "问一次完成", failed: "问一次失败" },
    },
    importHint: "一次性把开源目录里 4700 多家公司加为长尾板块;再点只补新增",
    importResult: (inserted: number, skipped: number) => `新增 ${inserted} 个板块,已有 ${skipped} 个,三天内自动铺开。`,
    pollResult: (inserted: number, hadErrors: boolean) => `新增 ${inserted} 个职位${hadErrors ? ",有错误,见板块行" : ""}。`,
    stats: { boards: "板块", jobs30: "30 天新职位", good30: "30 天 ≥75 分", errors24h: "24 小时出错" },
    families: {
      title: "按来源家族",
      lastTick: (when: string, boards: number, inserted: number, errors: number) =>
        `上次检查 ${when}:问了 ${boards} 个板块,新增 ${inserted} 个职位,${errors} 个出错。点一行只看该家族。`,
      noTick: "还没有检查记录。",
      columns: { family: "家族", core: "核心", longtail: "长尾", dormant: "休眠", muted: "静音", jobs30: "30 天新职位", good30: "30 天 ≥75", errors24h: "24h 出错" },
    },
    boards: {
      title: "板块",
      family: "家族",
      tier: "层级",
      searchPlaceholder: "搜公司或板块键",
      searchAria: "搜索板块",
      empty: "没有匹配的板块",
      columns: { board: "公司 / 板块", family: "家族", tier: "层级", lastPolled: "上次问", jobs30: "30 天新职位", good30: "30 天 ≥75" },
      manualSuffix: " · 手动",
      tierAria: (name: string) => `${name} 的层级`,
      unmute: "恢复",
      mute: "静音",
    },
    // "第 <1> / <3> 页 · 共 <120> 个" — the numbers are rendered in mono between these pieces.
    pagination: { prev: "上一页", next: "下一页", pagePrefix: "第 ", pageSep: " / ", pageSuffix: " 页 · 共 ", totalSuffix: " 个" },
    events: { title: "最近升降级", none: "还没有记录。" },
  },
  en: {
    subtitle: "Every minute the background checks which boards are due: core hourly, longtail daily, dormant weekly. This page is for troubleshooting; day to day you will not need it.",
    tiers: { core: "Core · hourly", longtail: "Longtail · daily", dormant: "Dormant · weekly", muted: "Muted" },
    origins: { seed: "Seed", directory: "Directory", url: "Found from a link", builtin: "Built-in" },
    loadFailed: "Could not load",
    actions: {
      retier: { done: "Tier changed", failed: "Could not change the tier" },
      import: { label: "Import open directory", done: "Directory imported", failed: "Directory import failed" },
      poll: { label: "Poll once", done: "Polled", failed: "Poll failed" },
    },
    importHint: "Adds the 4,700-plus companies in the open directory as longtail boards in one go; clicking again only adds new ones",
    importResult: (inserted: number, skipped: number) =>
      `${inserted} new ${inserted === 1 ? "board" : "boards"}, ${skipped} already known; they roll out over the next three days.`,
    pollResult: (inserted: number, hadErrors: boolean) => `${inserted} new ${inserted === 1 ? "job" : "jobs"}${hadErrors ? "; there were errors, see the board row" : ""}.`,
    stats: { boards: "Boards", jobs30: "New jobs, 30 days", good30: "≥75 pts, 30 days", errors24h: "Errors, 24 hours" },
    families: {
      title: "By source family",
      lastTick: (when: string, boards: number, inserted: number, errors: number) =>
        `Last check ${when}: ${boards} ${boards === 1 ? "board" : "boards"} polled, ${inserted} new ${inserted === 1 ? "job" : "jobs"}, ${errors} ${errors === 1 ? "error" : "errors"}. Click a row to see only that family.`,
      noTick: "No checks recorded yet.",
      columns: { family: "Family", core: "Core", longtail: "Longtail", dormant: "Dormant", muted: "Muted", jobs30: "New jobs, 30d", good30: "≥75, 30d", errors24h: "Errors, 24h" },
    },
    boards: {
      title: "Boards",
      family: "Family",
      tier: "Tier",
      searchPlaceholder: "Search by company or board key",
      searchAria: "Search boards",
      empty: "No matching boards",
      columns: { board: "Company / board", family: "Family", tier: "Tier", lastPolled: "Last polled", jobs30: "New jobs, 30d", good30: "≥75, 30d" },
      manualSuffix: " · manual",
      tierAria: (name: string) => `Tier for ${name}`,
      unmute: "Unmute",
      mute: "Mute",
    },
    // "Page <1> / <3> · <120> boards" — the numbers are rendered in mono between these pieces.
    pagination: { prev: "Previous", next: "Next", pagePrefix: "Page ", pageSep: " / ", pageSuffix: " · ", totalSuffix: " boards" },
    events: { title: "Recent tier changes", none: "Nothing recorded yet." },
  },
});
