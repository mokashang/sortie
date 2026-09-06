// Friendly labels for the profile's standard-answer keys. The keys themselves are what the
// apply executor looks up, so they stay stable; the UI shows the label and keeps the key as
// secondary text.
export const ANSWER_LABELS: Record<string, { label: string; hint?: string }> = {
  city: { label: "所在城市", hint: "如 Los Angeles" },
  start_date: { label: "可入职时间", hint: "如 2027 年第二季度" },
  location_preference: { label: "地点偏好", hint: "愿意工作的城市或地区" },
  engineering_preference: { label: "工程方向偏好", hint: "更想做的方向" },
  offer_deadline: { label: "Offer 截止日答复", hint: "被问到有没有其他 offer 截止日时的回答" },
  relocation: { label: "愿意搬去的城市", hint: "如 New York, Boston" },
  high_school: { label: "高中名称", hint: "Palantir 等会问" },
  high_school_grad_year: { label: "高中毕业年份" },
  intern_onsite_availability: { label: "学期中能否全职驻场实习", hint: "是/否 + 说明" },
  internship_pushes_graduation: { label: "实习会不会推迟毕业", hint: "通常填 No" },
  intern_important_factors: { label: "实习最看重的因素", hint: "最多 3 个" },
  summer_2026_plan: { label: "2026 夏天安排" },
  languages_spoken: { label: "语言能力", hint: "如 English, Mandarin" },
  why_company_note: { label: "「为什么想来贵司」的侧重", hint: "写自由陈述题时希望强调的方向" },
};

export function answerLabel(key: string): string {
  return ANSWER_LABELS[key]?.label ?? key;
}

export function answerHint(key: string): string | undefined {
  return ANSWER_LABELS[key]?.hint;
}
