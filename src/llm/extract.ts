// 从模型输出里稳健地抠出 JSON:模型常把 JSON 包在 ```json 围栏里,或前后加寒暄。
// 策略:先剥围栏;再从第一个 { 或 [ 起做括号配平,截出第一个完整的 JSON 值。
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;

  const trimmed = body.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to bracket-matching scan
  }

  const start = trimmed.search(/[{[]/);
  if (start === -1) throw new Error(`extractJson: no JSON value found in model output: ${text.slice(0, 120)}`);

  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const slice = trimmed.slice(start, i + 1);
        return JSON.parse(slice) as T;
      }
    }
  }
  throw new Error(`extractJson: no complete JSON value found in model output: ${text.slice(0, 120)}`);
}
