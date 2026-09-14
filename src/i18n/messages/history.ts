import { defineMessages } from "../define";

// 历史 — every submitted application (src/app/history/*). Stage names themselves come from the
// shared `stages` namespace; this file holds the page's own copy: the header count, filters,
// row chips, the status dialog and the funnel chart.
export const history = defineMessages({
  zh: {
    submittedCount: (n: number) => `已提交 ${n} 份`,
    empty: {
      title: "还没有投出去的申请",
      description: "在投递页确认提交后,申请会记到这里,之后的 OA、面试、Offer 也在这里更新。",
      action: "去投递",
    },
    filters: {
      track: "方向",
      mode: "投递方式",
      noMatch: "这个筛选下没有申请",
    },
    row: {
      referralVia: (name: string | null) => (name ? `内推 · ${name}` : "内推"),
      resume: (version: string) => `简历 ${version}`,
      lastUpdated: "最后更新",
    },
    stage: {
      changed: (company: string, stage: string) => `${company} → ${stage}`,
      updateFailed: "更新失败",
      changeStatus: "改状态",
      noteDescription: "可以顺手记一条备注,比如 OA 截止日或面试官。",
      noteLabel: "备注",
      notePlaceholder: "例如:OA 截止 9/15 · 面试官 Alex",
      submit: "更新状态",
    },
    funnel: {
      title: "投递漏斗",
      chartLabel: "投递漏斗桑基图",
      flow: (from: string, to: string, count: number) => `${from} → ${to}: ${count}`,
      node: (label: string, count: number) => `${label}: ${count}`,
    },
  },
  en: {
    submittedCount: (n: number) => (n === 1 ? "1 submitted" : `${n} submitted`),
    empty: {
      title: "No applications submitted yet",
      description: "Once you confirm a submission on the Apply page it is recorded here, and later OA, interview and offer news is updated here too.",
      action: "Go to Apply",
    },
    filters: {
      track: "Track",
      mode: "Apply mode",
      noMatch: "No applications match this filter",
    },
    row: {
      referralVia: (name: string | null) => (name ? `Referral · ${name}` : "Referral"),
      resume: (version: string) => `Resume ${version}`,
      lastUpdated: "Last updated",
    },
    stage: {
      changed: (company: string, stage: string) => `${company} → ${stage}`,
      updateFailed: "Could not update",
      changeStatus: "Change status",
      noteDescription: "Add a note if you like, such as the OA deadline or the interviewer.",
      noteLabel: "Note",
      notePlaceholder: "e.g. OA due 9/15 · interviewer Alex",
      submit: "Update status",
    },
    funnel: {
      title: "Application funnel",
      chartLabel: "Application funnel Sankey diagram",
      flow: (from: string, to: string, count: number) => `${from} → ${to}: ${count}`,
      node: (label: string, count: number) => `${label}: ${count}`,
    },
  },
});
