// 标题级 entry-level 粗筛:排除明显的资深岗,减少下游 LLM 匹配的浪费。
// 宁可放过不可错杀 —— 不确定的留给匹配引擎判断。
const EXCLUDE = /\b(senior|staff|principal|director|manager|lead|sr\.?|vp|head of|distinguished|architect)\b/i;
const INTERN_HINT = /\b(intern|internship|co-?op)\b/i;
// 强 entry-level 信号:即使标题里混有 EXCLUDE 词(如 "Member of Technical Staff New Grad"、
// "GPU Power Architect New Grad"),只要出现这些词就判定为 entry-level —— 头衔本身已经
// 明示了这是校招/初级岗,EXCLUDE 词多半是团队/职级体系里的固有名词而非真实资历要求。
const STRONG_ENTRY_LEVEL_OVERRIDE =
  /\b(new ?grad|university|campus|junior|entry.?level|graduate|intern(ship)?|co-?op)\b/i;

export function isEntryLevelTitle(title: string): boolean {
  if (STRONG_ENTRY_LEVEL_OVERRIDE.test(title)) return true;
  return !EXCLUDE.test(title);
}
export function jobKindFromTitle(title: string): "intern" | "newgrad" {
  return INTERN_HINT.test(title) ? "intern" : "newgrad";
}
