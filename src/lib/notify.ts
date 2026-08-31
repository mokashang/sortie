import { execFile } from "child_process";

type MacNotifier = (title: string, body: string) => void;

// Exported so it can be unit-tested directly: escape backslashes FIRST, then double-quotes, or
// a body/title containing a literal backslash before a quote (e.g. `a\"b`) would have its
// escaped quote's backslash re-escaped incorrectly, or worse, a raw backslash would survive
// into the AppleScript string un-escaped and change how the following character is interpreted.
// Order matters: escaping `"` before `\` would double-escape the backslash we just inserted.
export const escapeAppleScript = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const defaultMacNotifier: MacNotifier = (title, body) => {
  // osascript 弹系统通知;转义反斜杠和双引号防止脚本注入/语法错误
  const esc = escapeAppleScript;
  execFile(
    "osascript",
    ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`],
    (err) => {
      if (err) console.warn("[notify] osascript failed:", err);
    }
  );
};

// ntfy's Title header must be ASCII-safe. encodeURIComponent (the naive choice) produces raw
// percent-escapes like %E6%88%90 that ntfy passes through verbatim into the header value, and
// phones then show the literal percent-encoded garbage instead of decoding it. RFC 2047's
// encoded-word form (`=?UTF-8?B?<base64>?=`) is what ntfy (and mail clients) actually decode.
// Exported for direct unit testing.
export function encodeNtfyTitle(title: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(title)) return title;
  return `=?UTF-8?B?${Buffer.from(title, "utf8").toString("base64")}?=`;
}

export async function notify(
  title: string,
  body: string,
  opts: {
    ntfyTopic?: string;
    priority?: "default" | "high";
    fetcher?: typeof fetch;
    execMacNotifier?: MacNotifier;
  } = {}
): Promise<void> {
  const topic = opts.ntfyTopic ?? process.env.NTFY_TOPIC;
  const fetcher = opts.fetcher ?? fetch;
  const mac = opts.execMacNotifier ?? defaultMacNotifier;

  mac(title, body);
  if (topic) {
    try {
      await fetcher(`https://ntfy.sh/${topic}`, {
        method: "POST",
        body,
        headers: { Title: encodeNtfyTitle(title), Priority: opts.priority === "high" ? "high" : "default" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      // 通知失败绝不阻塞流水线(spec §11.1),但至少留个痕迹方便排查
      console.warn("[notify] ntfy push failed:", e);
    }
  }
}
