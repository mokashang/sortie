import { defineMessages } from "../define";

// 今日 — the decision inbox (src/app/today/today-client.tsx, src/app/page.tsx). Keys are grouped
// by the part of the page they belong to: the header, the number strip, the inbox section and
// the "front of the queue" list.
export const today = defineMessages({
  zh: {
    profileGate: { title: "先填好档案的基本信息", description: "助手要靠联系方式、学校、工作身份和方向来打分、生成简历、填表;填完就自动开始匹配。", cta: "去填写" },
    setup: {
      title: "新手上路",
      progress: (done: number, total: number) => `${done}/${total} 步`,
      basics: "填好基本信息",
      basicsHint: "联系方式、学校、毕业时间、签证,以及想投的方向。",
      resume: "上传你的简历",
      resumeHint: "助手投递时附上它。PDF 最好。",
      experiences: "把经历导进来",
      experiencesHint: "上传简历后一键导入,助手写附言、答表单题时有素材。",
      scoring: "等职位打分",
      scoringWaiting: "填好基本信息后,后台每分钟自动给新职位打分。",
      scoringProgress: (n: number) => `已经打了 ${n} 个职位,合适的会出现在「职位」里,还在继续。`,
      apply: "开始第一次投递",
      applyHint: (chrome: boolean): string =>
        chrome
          ? "在「投递」选好每个方向投几份,助手填好每份申请后等你确认再提交。"
          : "在「投递」选好每个方向投几份。助手在服务器上的后台浏览器里替你填表,你的电脑不用开着;每份都等你确认再提交。",
      go: "去做",
      done: "已完成",
    },
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
    setup: {
      title: "Getting started",
      progress: (done: number, total: number) => `${done} of ${total} done`,
      basics: "Fill in your basics",
      basicsHint: "Contact details, school, graduation date, visa status and the tracks you want.",
      resume: "Upload your resume",
      resumeHint: "The assistant attaches it to applications. PDF is best.",
      experiences: "Bring in your experience",
      experiencesHint: "Import it from your resume in one click, so the assistant has material for notes and form answers.",
      scoring: "Wait for jobs to be scored",
      scoringWaiting: "Once your basics are in, new jobs are scored in the background every minute.",
      scoringProgress: (n: number) => `${n} job${n === 1 ? "" : "s"} scored so far; good fits show up under Jobs, and it keeps going.`,
      apply: "Start your first applications",
      applyHint: (chrome: boolean): string =>
        chrome
          ? "Under Apply, pick how many per track; the assistant fills each application and waits for your OK before submitting."
          : "Under Apply, pick how many per track. The assistant fills the forms in a background browser on the server, so your computer doesn't need to stay on; each one waits for your OK before it's submitted.",
      go: "Go",
      done: "Done",
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
