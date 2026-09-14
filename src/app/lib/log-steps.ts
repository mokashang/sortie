// Turns the assistant's timestamped log lines ("[HH:MM:SS] text") into classified steps for the
// 查看步骤 timeline. Classification is keyword-based and only affects the icon/colour of a step.
export type StepKind = "info" | "ok" | "wait" | "warn" | "error";

export interface LogStep {
  at: string | null;
  text: string;
  kind: StepKind;
}

const RULES: [StepKind, RegExp][] = [
  ["error", /失败|错误|error|异常|验证码|限流/i],
  ["warn", /跳过|needs_manual|需人工|暂停|待处理|登录墙|归档|超时|不合格|拦下/],
  ["wait", /等待|心跳|轮询|等你|排队/],
  ["ok", /已提交|成功|完成|已发出|已发送|批准/],
];

export function parseLogLine(line: string): LogStep {
  const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s?([\s\S]*)$/);
  const at = m ? m[1] : null;
  const text = m ? m[2] : line;
  const kind = RULES.find(([, re]) => re.test(text))?.[0] ?? "info";
  return { at, text, kind };
}

export function parseLog(lines: string[]): LogStep[] {
  return lines.filter((l) => l.trim().length > 0).map(parseLogLine);
}
