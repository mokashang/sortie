// 从模型输出里稳健地抠出 JSON:模型常把 JSON 包在 ```json 围栏里,或前后加寒暄,
// 有时寒暄本身也含孤立的括号(比如 "见下 {备注}"),或模型输出带尾随逗号的近似 JSON。
// 策略:先剥围栏;再从每个 { 或 [ 起做括号配平,依次尝试候选切片,严格解析失败时
// 再尝试"剥掉尾随逗号"的宽松解析;都失败就跳到下一个候选起点,直到穷尽全部候选。
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;

  const trimmed = body.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to bracket-matching scan
  }

  let searchFrom = 0;
  while (true) {
    const rel = trimmed.slice(searchFrom).search(/[{[]/);
    if (rel === -1) break;
    const start = searchFrom + rel;

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
          const parsed = tryParseLenient<T>(slice);
          if (parsed !== undefined) return parsed;
          break; // this candidate didn't parse even leniently — try the next bracket
        }
      }
    }

    // Advance past this start index and look for the next candidate bracket.
    searchFrom = start + 1;
  }

  throw new Error(`extractJson: no JSON value found in model output: ${text.slice(0, 120)}`);
}

// Strict parse first; if that fails, retry once after stripping trailing commas
// before a closing } or ] (a common near-miss in model output). Returns undefined
// (never throws) so the caller can move on to the next bracket candidate.
function tryParseLenient<T>(slice: string): T | undefined {
  try {
    return JSON.parse(slice) as T;
  } catch {
    // fall through to lenient retry
  }
  const stripped = slice.replace(/,(\s*[}\]])/g, "$1");
  if (stripped === slice) return undefined;
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return undefined;
  }
}
