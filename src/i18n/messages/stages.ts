import { defineMessages } from "../define";

// The post-submit ladder (src/apply/stages.ts) and the /history funnel's outcome buckets
// (src/apply/funnel.ts).
export const stages = defineMessages({
  zh: {
    stage: {
      submitted: "已提交",
      oa: "OA",
      interview: "面试",
      offer: "Offer",
      offer_accepted: "已接受",
      offer_declined: "已婉拒",
      rejected: "被拒",
      stale: "无回音",
    },
    funnel: {
      wait: "等回音",
      dropSubmitted: "被拒 / 无回音",
      dropOa: "OA 后无下文",
      dropInterview: "面试后无 Offer",
    },
  },
  en: {
    stage: {
      submitted: "Submitted",
      oa: "OA",
      interview: "Interview",
      offer: "Offer",
      offer_accepted: "Accepted",
      offer_declined: "Declined",
      rejected: "Rejected",
      stale: "No response",
    },
    funnel: {
      wait: "Waiting",
      dropSubmitted: "Rejected / no response",
      dropOa: "Silent after OA",
      dropInterview: "No offer after interview",
    },
  },
});
