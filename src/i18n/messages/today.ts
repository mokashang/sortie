import { defineMessages } from "../define";

// 今日 — the decision inbox (src/app/today/today-client.tsx, src/app/page.tsx). Keys are grouped
// by the part of the page they belong to: the header, the number strip, the inbox section and
// the "front of the queue" list.
export const today = defineMessages({
  zh: {
    profileGate: { title: "先填好档案的基本信息", description: "助手要靠联系方式、学校、工作身份和方向来打分、生成简历、填表;填完就自动开始匹配。", cta: "去填写" },
    head: {
      nothingToDecide: "今天没有需要你决定的事",
      toDecide: (n: number) => `有 ${n} 件事等你决定`,
      startApply: "开始投递",
    },
    stats: {
      queueReady: "队列可投",
      queueReadyHint: "分数达标、未归档、未投的职位",
      submittedToday: "今日已提交",
      submittedThisWeek: "本周已提交",
      referralsInProgress: "内推进行中",
    },
    inbox: {
      title: "需要你处理",
      networkDrafts: (n: number) => `${n} 条 coffee chat 草稿待你批准`,
      networkDraftsDescription: "人脉页的草稿只有你批准后,助手才会发送。",
      goApprove: "去批准",
      emptyTitle: "收件箱是空的",
      emptyDescription: "助手填好的申请、缺的答案、待批的内推留言都会出现在这里。",
      planApply: "安排一次投递",
    },
    front: {
      title: "队列前排",
      seeAll: "看全部 →",
    },
  },
  en: {
    profileGate: {
      title: "Fill in the basics of your profile first",
      description: "The assistant needs your contact details, school, work authorization and tracks to score jobs, build resumes and fill forms; matching starts on its own once they are in.",
      cta: "Fill them in",
    },
    head: {
      nothingToDecide: "Nothing needs your decision today",
      toDecide: (n: number) => (n === 1 ? "1 thing needs your decision" : `${n} things need your decision`),
      startApply: "Start applying",
    },
    stats: {
      queueReady: "Ready to apply",
      queueReadyHint: "Jobs that scored high enough, are not archived and have not been applied to",
      submittedToday: "Submitted today",
      submittedThisWeek: "Submitted this week",
      referralsInProgress: "Referrals in progress",
    },
    inbox: {
      title: "Needs your attention",
      networkDrafts: (n: number) => (n === 1 ? "1 coffee chat draft awaits your approval" : `${n} coffee chat drafts await your approval`),
      networkDraftsDescription: "The assistant only sends a draft from the Network page after you approve it.",
      goApprove: "Review",
      emptyTitle: "Your inbox is empty",
      emptyDescription: "Applications the assistant has filled in, missing answers and referral notes awaiting approval all show up here.",
      planApply: "Plan a round of applications",
    },
    front: {
      title: "Up next",
      seeAll: "See all →",
    },
  },
});
