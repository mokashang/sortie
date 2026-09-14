// Turns the assistant's timestamped log lines ("[HH:MM:SS] text") into classified steps for the
// 查看步骤 timeline. Classification is keyword-based (Chinese or English, whichever the assistant
// wrote in) and only affects the icon/colour of a step.
export type StepKind = "info" | "ok" | "wait" | "warn" | "error";

export interface LogStep {
  at: string | null;
  text: string;
  kind: StepKind;
}

const RULES: [StepKind, RegExp][] = [
  ["error", /失败|错误|error|failed|异常|验证码|captcha|限流|rate.?limit/i],
  ["warn", /跳过|needs_manual|需人工|暂停|待处理|登录墙|归档|超时|不合格|拦下|skip|manual|archiv|timed? ?out|ineligible|paused|login wall|to.?do/i],
  ["wait", /等待|心跳|轮询|等你|排队|waiting|heartbeat|poll|queued/i],
  ["ok", /已提交|成功|完成|已发出|已发送|批准|submitted|success|done|complete|sent|approved/i],
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
