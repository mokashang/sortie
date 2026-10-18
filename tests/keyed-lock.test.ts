import { describe, it, expect } from "vitest";
import { withKeyedLock } from "@/lib/keyed-lock";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withKeyedLock", () => {
  it("runs callers with the same key one after another, in arrival order", async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) =>
      withKeyedLock("outreach:1", async () => {
        log.push(`${name} start`);
        await tick(ms);
        log.push(`${name} end`);
        return name;
      });
    const results = await Promise.all([job("a", 20), job("b", 1)]);
    expect(results).toEqual(["a", "b"]);
    expect(log).toEqual(["a start", "a end", "b start", "b end"]);
  });

  it("does not make different keys wait, and a failure does not block the next caller", async () => {
    const log: string[] = [];
    const slow = withKeyedLock("outreach:2", async () => {
      await tick(20);
      log.push("slow");
    });
    await withKeyedLock("outreach:3", async () => {
      log.push("other key");
    });
    await expect(withKeyedLock("outreach:2", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withKeyedLock("outreach:2", async () => "after")).toBe("after");
    await slow;
    expect(log).toEqual(["other key", "slow"]);
  });
});
