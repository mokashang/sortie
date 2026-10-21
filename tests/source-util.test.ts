import { describe, it, expect } from "vitest";
import { retryAfterSec, rotate, httpError } from "@/scanner/sources/util";

describe("adapter utils", () => {
  it("reads Retry-After as seconds or an HTTP date", () => {
    const now = Date.parse("2026-10-21T20:59:25Z");
    expect(retryAfterSec("23824", now)).toBe(23824);
    expect(retryAfterSec("Wed, 21 Oct 2026 21:09:25 GMT", now)).toBe(600);
    expect(retryAfterSec(null, now)).toBeNull();
    expect(retryAfterSec("soon", now)).toBeNull();
  });
  it("rotates keywords by the minute so a cut-short poll starts elsewhere next time", () => {
    const kws = ["a", "b", "c"];
    expect(rotate(kws, new Date(0))).toEqual(["a", "b", "c"]);
    expect(rotate(kws, new Date(60_000))).toEqual(["b", "c", "a"]);
    expect(rotate(kws, new Date(5 * 60_000))).toEqual(["c", "a", "b"]);
    expect(rotate([], new Date())).toEqual([]);
  });
  it("puts status and Retry-After into the error the scheduler parses", () => {
    expect(httpError("x", new Response("", { status: 500 })).message).toBe("x: HTTP 500");
    expect(httpError("x", new Response("", { status: 429, headers: { "retry-after": "60" } })).message).toBe("x: HTTP 429 (retry-after 60s)");
  });
});
