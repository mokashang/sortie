// 兜底:上游 ATS/清单偶尔给出格式错误的日期(如非数字 epoch、"n/a" 之类的占位字符串),
// 单条脏日期数据不该让整批抓取因 RangeError 崩掉 —— 无法解析就返回 null,由下游按“未知发布时间”处理。
export function safeIso(input: number | string | null | undefined): string | null {
  if (input === null || input === undefined || input === "") return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
