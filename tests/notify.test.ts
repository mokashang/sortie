import { describe, it, expect, vi } from "vitest";
import { notify } from "@/lib/notify";

describe("notify", () => {
  it("posts to ntfy when topic configured and calls macos notifier", async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("ok");
    };
    const fakeExec = vi.fn();
    await notify("标题", "正文内容", {
      ntfyTopic: "test-topic",
      fetcher: fakeFetch as typeof fetch,
      execMacNotifier: fakeExec,
    });
    expect(calls[0].url).toBe("https://ntfy.sh/test-topic");
    expect(calls[0].body).toBe("正文内容");
    expect(fakeExec).toHaveBeenCalledOnce();
  });

  it("skips ntfy silently when no topic", async () => {
    const fakeFetch = vi.fn();
    await notify("t", "b", { ntfyTopic: undefined, fetcher: fakeFetch, execMacNotifier: vi.fn() });
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
