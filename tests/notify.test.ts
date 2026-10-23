import { describe, it, expect, vi } from "vitest";
import { notify, escapeAppleScript, encodeNtfyTitle, resetNotifyWarningForTests } from "@/lib/notify";
import { setNtfyTopic } from "@/lib/notify-user";

describe("notify", () => {
  it("posts to ntfy when topic configured and calls macos notifier", async () => {
    const calls: { url: string; body: string; init?: RequestInit }[] = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body), init });
      return new Response("ok");
    };
    const fakeExec = vi.fn();
    await notify("标题", "正文内容", {
      ntfyTopic: "test-topic",
      fetcher: fakeFetch as typeof fetch,
      execMacNotifier: fakeExec,
      platform: "darwin",
    });
    expect(calls[0].url).toBe("https://ntfy.sh/test-topic");
    expect(calls[0].body).toBe("正文内容");
    expect(fakeExec).toHaveBeenCalledOnce();
    // fetch is given an abort signal (timeout guard) rather than hanging forever
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("skips ntfy silently when no topic", async () => {
    const fakeFetch = vi.fn();
    await notify("t", "b", { ntfyTopic: undefined, fetcher: fakeFetch, execMacNotifier: vi.fn() });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("does not throw when ntfy fetch rejects (failure-tolerant, but warns)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeFetch = async () => {
      throw new Error("network down");
    };
    await expect(
      notify("t", "b", { ntfyTopic: "topic", fetcher: fakeFetch, execMacNotifier: vi.fn() })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not call the macOS notifier off macOS", async () => {
    const fakeExec = vi.fn();
    const fakeFetch = async () => new Response("ok");
    await notify("t", "b", { ntfyTopic: "topic", fetcher: fakeFetch as typeof fetch, execMacNotifier: fakeExec, platform: "win32" });
    expect(fakeExec).not.toHaveBeenCalled();
  });

  it("warns once per process when off macOS and no ntfy topic is configured", async () => {
    vi.stubEnv("NTFY_TOPIC", "");
    resetNotifyWarningForTests();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opts = { ntfyTopic: undefined, fetcher: vi.fn() as unknown as typeof fetch, execMacNotifier: vi.fn(), platform: "win32" as const };
    await notify("t", "b", opts);
    await notify("t", "b", opts);
    const topicWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes("NTFY_TOPIC"));
    expect(topicWarnings).toHaveLength(1);
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("escapeAppleScript", () => {
  // Regression for CRITICAL 1: the previous version only escaped `"`, so a title/body
  // containing a raw backslash (e.g. right before a quote) could break out of the
  // AppleScript string literal. Backslashes must be escaped BEFORE quotes.
  it("escapes a lone double-quote", () => {
    expect(escapeAppleScript('a"b')).toBe('a\\"b');
  });

  it("escapes a lone backslash", () => {
    expect(escapeAppleScript("a\\b")).toBe("a\\\\b");
  });

  it("escapes a backslash immediately followed by a quote without double-escaping", () => {
    expect(escapeAppleScript('a\\"b')).toBe('a\\\\\\"b');
  });
});

describe("encodeNtfyTitle", () => {
  it("passes pure-ASCII titles through unchanged", () => {
    expect(encodeNtfyTitle("Sortie")).toBe("Sortie");
  });

  it("RFC-2047-encodes titles containing non-ASCII characters", () => {
    const title = "扫描完成";
    const encoded = encodeNtfyTitle(title);
    expect(encoded).toBe(`=?UTF-8?B?${Buffer.from(title, "utf8").toString("base64")}?=`);
    expect(encoded.startsWith("=?UTF-8?B?")).toBe(true);
  });
});

import { openDb } from "@/lib/db";
import { seedOwner, seedUser } from "./helpers";
describe("notify only reaches the owner's phone with the owner's news", () => {
  it("pushes an owner event and drops another account's", async () => {
    const db = openDb(":memory:");
    seedOwner(db, "legacy");
    seedUser(db, "m1", "m1@example.com", { role: "member" });
    const sent: string[] = [];
    const fetcher = (async (_u: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response("ok");
    }) as unknown as typeof fetch;
    await notify("t", "owner news", { ntfyTopic: "topic", fetcher, platform: "win32", account: { db, userId: "legacy" } });
    await notify("t", "member news", { ntfyTopic: "topic", fetcher, platform: "win32", account: { db, userId: "m1" } });
    expect(sent).toEqual(["owner news"]);
  });

  it("pushes another account's news to the channel that account set, never to the owner's", async () => {
    const db = openDb(":memory:");
    seedOwner(db, "legacy");
    seedUser(db, "m1", "m1@example.com", { role: "member" });
    setNtfyTopic(db, "m1", "brother-channel");
    const urls: string[] = [];
    const fetcher = (async (u: string) => {
      urls.push(u);
      return new Response("ok");
    }) as unknown as typeof fetch;
    await notify("t", "member news", { fetcher, platform: "win32", account: { db, userId: "m1" } });
    expect(urls).toEqual(["https://ntfy.sh/brother-channel"]);
    expect(() => setNtfyTopic(db, "m1", "bad topic!")).toThrow();
  });
});
