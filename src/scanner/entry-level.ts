// 标题级 entry-level 粗筛:排除明显的资深岗,减少下游 LLM 匹配的浪费。
// 宁可放过不可错杀 —— 不确定的留给匹配引擎判断。
const EXCLUDE = /\b(senior|staff|principal|director|manager|lead|sr\.?|vp|head of|distinguished|architect)\b/i;
const INTERN_HINT = /\b(intern|internship|co-?op)\b/i;

export function isEntryLevelTitle(title: string): boolean {
  return !EXCLUDE.test(title);
}
export function jobKindFromTitle(title: string): "intern" | "newgrad" {
  return INTERN_HINT.test(title) ? "intern" : "newgrad";
}
