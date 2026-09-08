import { describe, it, expect, vi } from "vitest";
import { killTree } from "@/lib/proc-kill";

describe("killTree", () => {
  it("SIGTERMs the process group on POSIX", () => {
    const calls: [number, string][] = [];
    killTree(4242, { platform: "darwin", kill: (p, s) => { calls.push([p, s]); } });
    expect(calls).toEqual([[-4242, "SIGTERM"]]);
  });

  it("falls back to the bare pid when the group kill throws, and swallows a second failure", () => {
    const calls: number[] = [];
    killTree(7, {
      platform: "linux",
      kill: (p) => {
        calls.push(p);
        if (p < 0) throw new Error("ESRCH");
      },
    });
    expect(calls).toEqual([-7, 7]);
    expect(() => killTree(8, { platform: "linux", kill: () => { throw new Error("ESRCH"); } })).not.toThrow();
  });

  it("uses taskkill /T /F on Windows and never signals", () => {
    const execs: [string, string[]][] = [];
    const kill = vi.fn();
    killTree(123, { platform: "win32", exec: (f, a) => { execs.push([f, a]); }, kill });
    expect(execs).toEqual([["taskkill", ["/pid", "123", "/t", "/f"]]]);
    expect(kill).not.toHaveBeenCalled();
  });
});
