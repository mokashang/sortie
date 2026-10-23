import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchJdText } from "@/scanner/jd-fetch";

const htmlFixture = fs.readFileSync("tests/fixtures/jd-page.html", "utf8");

describe("fetchJdText", () => {
  it("fetches HTML, strips script/style/nav/header/footer, and extracts main text", async () => {
    const fakeFetch = async () =>
      new Response(htmlFixture, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const text = await fetchJdText("https://acme.example/jobs/123", fakeFetch);
    expect(text).not.toBeNull();
    expect(text).toContain("Software Engineer");
    expect(text).toContain("unable to sponsor visas");
    expect(text).toContain("BS/MS in Computer Science");
    // script/style/nav/header/footer content must never leak into the extracted text
    expect(text).not.toContain("tracking pixel junk");
    expect(text).not.toContain("dataLayer");
    expect(text).not.toContain("Home");
    expect(text).not.toContain("Jobs");
    expect(text).not.toContain("All rights reserved");
    expect(text).not.toContain("font-family");
  });

  it("passes a normal browser User-Agent and a 15s timeout signal, following redirects itself", async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch = async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(htmlFixture, { status: 200, headers: { "content-type": "text/html" } });
    };
    await fetchJdText("https://acme.example/jobs/123", fakeFetch);
    // Redirects are followed hop by hop so each target is checked (src/lib/public-url.ts).
    expect(capturedInit?.redirect).toBe("manual");
    const headers = new Headers(capturedInit?.headers);
    const ua = headers.get("user-agent") ?? "";
    expect(ua.length).toBeGreaterThan(10);
    expect(ua).toMatch(/Mozilla|Chrome|Safari/i);
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null on non-200 responses", async () => {
    const fakeFetch = async () => new Response("not found", { status: 404 });
    const text = await fetchJdText("https://acme.example/jobs/dead", fakeFetch);
    expect(text).toBeNull();
  });

  it("returns null on non-HTML content types", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    const text = await fetchJdText("https://acme.example/api/job", fakeFetch);
    expect(text).toBeNull();
  });

  it("returns null when the fetcher throws (network error, timeout, etc.)", async () => {
    const fakeFetch = async () => {
      throw new Error("network error");
    };
    const text = await fetchJdText("https://acme.example/jobs/timeout", fakeFetch);
    expect(text).toBeNull();
  });

  it("caps extracted text at 20000 chars", async () => {
    const bigBody = `<html><body><main>${"x".repeat(30000)}</main></body></html>`;
    const fakeFetch = async () => new Response(bigBody, { status: 200, headers: { "content-type": "text/html" } });
    const text = await fetchJdText("https://acme.example/jobs/huge", fakeFetch);
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(20000);
  });
});

describe("fetchJdText stays on the public internet", () => {
  const page = () => new Response("<main>Software Engineer posting text</main>", { status: 200, headers: { "content-type": "text/html" } });
  it("refuses loopback, private, tailnet and local names without fetching", async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return page();
    };
    for (const u of [
      "http://127.0.0.1:3000/api/overview",
      "http://localhost:3000/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://100.100.246.31/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://laptop-kvharru8.tailbffe80.ts.net/",
      "http://router/",
      "file:///C:/sortie/data/internal-token",
    ]) {
      expect(await fetchJdText(u, fakeFetch)).toBeNull();
    }
    expect(calls).toBe(0);
  });
  it("re-checks redirect targets", async () => {
    const seen: string[] = [];
    const fakeFetch = async (url: string) => {
      seen.push(url);
      return new Response("", { status: 302, headers: { location: "http://127.0.0.1:3000/api/overview" } });
    };
    expect(await fetchJdText("https://acme.example/jobs/1", fakeFetch)).toBeNull();
    expect(seen).toEqual(["https://acme.example/jobs/1"]);
  });
  it("follows a public redirect", async () => {
    const fakeFetch = async (url: string) =>
      url.endsWith("/old") ? new Response("", { status: 301, headers: { location: "/new" } }) : page();
    expect(await fetchJdText("https://acme.example/old", fakeFetch)).toContain("Software Engineer");
  });
});
