import { execFile } from "child_process";

type MacNotifier = (title: string, body: string) => void;

const defaultMacNotifier: MacNotifier = (title, body) => {
  // osascript 弹系统通知;转义双引号防注入
  const esc = (s: string) => s.replace(/"/g, '\\"');
  execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
};

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
        headers: { Title: encodeURIComponent(title), Priority: opts.priority === "high" ? "high" : "default" },
      });
    } catch {
      // 通知失败绝不阻塞流水线(spec §11.1)
    }
  }
}
