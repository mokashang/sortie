import { describe, it, expect } from "vitest";
import { addressOf, decodeBase64Url, domainOf, htmlToText, listMessageIds, parseMessage, refreshAccessToken, GmailError, MAX_MAIL_TEXT } from "@/inbox/google";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("inbox/google parseMessage", () => {
  it("prefers the text/plain part of a multipart mail and reads the headers", () => {
    const parsed = parseMessage({
      id: "m1",
      threadId: "t1",
      snippet: "We regret to inform you",
      internalDate: "1758400000000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Acme Recruiting <no-reply@greenhouse.io>" },
          { name: "Subject", value: "Your application to Acme" },
          { name: "Date", value: "Sat, 20 Sep 2026 21:00:00 +0000" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Hi Mengjia,\r\n\r\nWe regret to inform you…\r\n") } },
          { mimeType: "text/html", body: { data: b64("<p>Hi Mengjia,</p><p>We regret to inform you…</p>") } },
        ],
      },
    });
    expect(parsed).toMatchObject({ id: "m1", threadId: "t1", from: "Acme Recruiting <no-reply@greenhouse.io>", subject: "Your application to Acme", receivedAtMs: 1758400000000 });
    expect(parsed.text).toBe("Hi Mengjia,\n\nWe regret to inform you…");
    expect(parsed.snippet).toBe("We regret to inform you");
  });

  it("falls back to stripped HTML, then to the snippet, and truncates long bodies", () => {
    const html = parseMessage({
      id: "m2",
      payload: {
        mimeType: "text/html",
        headers: [{ name: "Date", value: "Sat, 20 Sep 2026 21:00:00 +0000" }],
        body: { data: b64("<html><style>p{color:red}</style><body><h1>Next steps</h1><p>Please complete the <b>HackerRank</b> test &amp; reply.</p><br><div>Thanks</div></body></html>") },
      },
    });
    expect(html.text).toBe("Next steps\nPlease complete the HackerRank test & reply.\nThanks");
    expect(html.receivedAtMs).toBe(Date.parse("Sat, 20 Sep 2026 21:00:00 +0000"));

    const snippetOnly = parseMessage({ id: "m3", snippet: "only a snippet", payload: { mimeType: "text/plain", body: {} } });
    expect(snippetOnly.text).toBe("only a snippet");

    const long = parseMessage({ id: "m4", payload: { mimeType: "text/plain", body: { data: b64("x".repeat(MAX_MAIL_TEXT + 500)) } } });
    expect(long.text.length).toBe(MAX_MAIL_TEXT);
  });

  it("skips attachment parts and nested multiparts still yield the text", () => {
    const parsed = parseMessage({
      id: "m5",
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("inner text") } }] },
          { mimeType: "text/plain", filename: "notes.txt", body: { data: b64("attachment body") } },
        ],
      },
    });
    expect(parsed.text).toBe("inner text");
  });

  it("decodes base64url and reads sender address / domain", () => {
    expect(decodeBase64Url(b64("héllo?>"))).toBe("héllo?>");
    expect(addressOf("Acme <No-Reply@Acme.COM>")).toBe("no-reply@acme.com");
    expect(addressOf("bare@lever.co")).toBe("bare@lever.co");
    expect(domainOf("Acme <no-reply@mail.acme.com>")).toBe("mail.acme.com");
    expect(domainOf("nonsense")).toBe("");
    expect(htmlToText("a&#8217;s &quot;q&quot;")).toBe("a’s \"q\"");
  });
});

describe("inbox/google http", () => {
  it("refreshAccessToken posts the refresh grant and maps invalid_grant to 401", async () => {
    const calls: { url: string; body: string }[] = [];
    const ok = await refreshAccessToken("rt-1", {
      clientId: "cid",
      clientSecret: "sec",
      fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return jsonResponse({ access_token: "at-1", expires_in: 3599 });
      }) as typeof fetch,
    });
    expect(ok).toEqual({ accessToken: "at-1", expiresInS: 3599 });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].body).toContain("refresh_token=rt-1");
    expect(calls[0].body).toContain("grant_type=refresh_token");

    await expect(
      refreshAccessToken("rt-dead", { clientId: "cid", clientSecret: "sec", fetcher: (async () => jsonResponse({ error: "invalid_grant" }, 400)) as typeof fetch })
    ).rejects.toMatchObject({ name: "GmailError", status: 401 });
  });

  it("listMessageIds pages until max and carries the query", async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      urls.push(u.toString());
      const page = u.searchParams.get("pageToken");
      if (!page) return jsonResponse({ messages: [{ id: "a", threadId: "ta" }, { id: "b", threadId: "tb" }], nextPageToken: "p2" });
      return jsonResponse({ messages: [{ id: "c", threadId: "tc" }] });
    }) as typeof fetch;
    const refs = await listMessageIds("tok", "after:1 -in:spam", { max: 3, fetcher });
    expect(refs.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(urls[0]).toContain("q=after%3A1+-in%3Aspam");
    expect(urls[0]).toContain("maxResults=3");
    expect(urls[1]).toContain("pageToken=p2");

    await expect(listMessageIds("tok", "x", { fetcher: (async () => new Response("nope", { status: 403 })) as typeof fetch })).rejects.toBeInstanceOf(GmailError);
  });
});
