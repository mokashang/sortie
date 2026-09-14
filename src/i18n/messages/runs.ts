import { defineMessages } from "../define";

// The one-line description of what a task was asked to do (src/app/lib/describe-run.ts).
export const runs = defineMessages({
  zh: {
    resumeApply: "恢复模式:补提交已批准的申请",
    resume: "恢复模式",
    referralSuffix: " · 内推",
    first: (n: number) => `前 ${n} 个`,
    findReferral: "找内推",
    applyDirect: "直接投",
    jobs: (ids: string) => `岗位 ${ids}`,
  },
  en: {
    resumeApply: "Resume mode: submit the approved applications",
    resume: "Resume mode",
    referralSuffix: " · referral",
    first: (n: number) => `first ${n}`,
    findReferral: "Find referrals",
    applyDirect: "Apply directly",
    jobs: (ids: string) => `jobs ${ids}`,
  },
});
