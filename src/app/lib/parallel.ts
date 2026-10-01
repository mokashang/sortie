// 设置 → 同时进行的任务: how many apply tasks the assistant works on at once, one attended session
// each (src/executor/sessions.ts stores it; the dispatcher in src/executor/attended.ts obeys it).
// Client-safe: the settings page offers these choices.
export const PARALLEL_CHOICES = [1, 2, 3] as const;
export const DEFAULT_PARALLEL = 2;

export function isParallelChoice(n: unknown): n is (typeof PARALLEL_CHOICES)[number] {
  return typeof n === "number" && (PARALLEL_CHOICES as readonly number[]).includes(n);
}
