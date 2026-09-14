import { defineMessages } from "../define";

// Friendly names for the profile's standard-answer keys (src/app/lib/answer-labels.ts). The keys
// themselves are what the apply executor looks up, so they stay stable in both languages.
export const answers = defineMessages({
  zh: {
    fields: {
      city: { label: "所在城市", hint: "如 Los Angeles" },
      start_date: { label: "可入职时间", hint: "如 2027 年第二季度" },
      location_preference: { label: "地点偏好", hint: "愿意工作的城市或地区" },
      engineering_preference: { label: "工程方向偏好", hint: "更想做的方向" },
      offer_deadline: { label: "Offer 截止日答复", hint: "被问到有没有其他 offer 截止日时的回答" },
      relocation: { label: "愿意搬去的城市", hint: "如 New York, Boston" },
      high_school: { label: "高中名称", hint: "Palantir 等会问" },
      high_school_grad_year: { label: "高中毕业年份", hint: "" },
      intern_onsite_availability: { label: "学期中能否全职驻场实习", hint: "是/否 + 说明" },
      internship_pushes_graduation: { label: "实习会不会推迟毕业", hint: "通常填 No" },
      intern_important_factors: { label: "实习最看重的因素", hint: "最多 3 个" },
      summer_2026_plan: { label: "2026 夏天安排", hint: "" },
      languages_spoken: { label: "语言能力", hint: "如 English, Mandarin" },
      why_company_note: { label: "「为什么想来贵司」的侧重", hint: "写自由陈述题时希望强调的方向" },
    },
  },
  en: {
    fields: {
      city: { label: "City", hint: "e.g. Los Angeles" },
      start_date: { label: "Earliest start date", hint: "e.g. Q2 2027" },
      location_preference: { label: "Location preference", hint: "Cities or regions you would work in" },
      engineering_preference: { label: "Engineering focus", hint: "The kind of work you want most" },
      offer_deadline: { label: "Offer deadline answer", hint: "What to say when asked about other offer deadlines" },
      relocation: { label: "Cities you would relocate to", hint: "e.g. New York, Boston" },
      high_school: { label: "High school", hint: "Palantir and a few others ask" },
      high_school_grad_year: { label: "High school graduation year", hint: "" },
      intern_onsite_availability: { label: "Full-time on-site internship during the semester", hint: "Yes/No plus a note" },
      internship_pushes_graduation: { label: "Would an internship delay graduation", hint: "Usually No" },
      intern_important_factors: { label: "Most important internship factors", hint: "Up to 3" },
      summer_2026_plan: { label: "Summer 2026 plans", hint: "" },
      languages_spoken: { label: "Languages spoken", hint: "e.g. English, Mandarin" },
      why_company_note: { label: "Angle for 'why this company'", hint: "What to emphasise in free-text answers" },
    },
  },
});
