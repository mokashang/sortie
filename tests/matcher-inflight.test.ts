import { describe, it, expect, beforeEach } from "vitest";
import { tryAcquireMatching, releaseMatching, isMatchingInFlight } from "@/matcher/inflight";

describe("matcher inflight lock", () => {
  beforeEach(() => {
    releaseMatching();
  });

  it("acquire returns true then false until released", () => {
    expect(isMatchingInFlight()).toBe(false);
    expect(tryAcquireMatching()).toBe(true);
    expect(isMatchingInFlight()).toBe(true);
    expect(tryAcquireMatching()).toBe(false);
    expect(tryAcquireMatching()).toBe(false);
  });

  it("release then acquire true again", () => {
    expect(tryAcquireMatching()).toBe(true);
    releaseMatching();
    expect(isMatchingInFlight()).toBe(false);
    expect(tryAcquireMatching()).toBe(true);
  });

  it("isMatchingInFlight reflects state", () => {
    expect(isMatchingInFlight()).toBe(false);
    tryAcquireMatching();
    expect(isMatchingInFlight()).toBe(true);
    releaseMatching();
    expect(isMatchingInFlight()).toBe(false);
  });
});
