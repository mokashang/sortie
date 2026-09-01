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

  it("passes a normal browser User-Agent and follows redirects with a 15s timeout signal", async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch = async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(htmlFixture, { status: 200, headers: { "content-type": "text/html" } });
    };
    await fetchJdText("https://acme.example/jobs/123", fakeFetch);
    expect(capturedInit?.redirect).not.toBe("manual");
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
