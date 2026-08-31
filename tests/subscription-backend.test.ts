import { describe, it, expect } from "vitest";
import { SubscriptionBackend, describeRunnerError, RunnerErrorLike } from "@/llm/backends/subscription";

// 模拟 `claude -p --output-format json` 的信封:.result 里是模型文本,可能带围栏。
function fakeRunner(envelope: object, opts: { exitCode?: number; stderr?: string } = {}) {
  return async (_bin: string, _args: string[], _input: string) => ({
    stdout: JSON.stringify(envelope),
    stderr: opts.stderr ?? "",
    exitCode: opts.exitCode ?? 0,
  });
}

describe("SubscriptionBackend", () => {
  it("extracts the result field from the claude json envelope", async () => {
    const be = new SubscriptionBackend({
      runner: fakeRunner({ type: "result", is_error: false, result: '```json\n{"score":88}\n```' }),
    });
    const r = await be.complete({ prompt: "score this" });
    expect(r.text).toBe('```json\n{"score":88}\n```');
    expect(r.backend).toBe("subscription");
  });

  it("throws when the CLI exits non-zero", async () => {
    const be = new SubscriptionBackend({
      runner: fakeRunner({}, { exitCode: 1, stderr: "not logged in" }),
    });
    await expect(be.complete({ prompt: "x" })).rejects.toThrow(/exit 1|not logged in/i);
  });

  it("throws when the envelope reports is_error", async () => {
    const be = new SubscriptionBackend({
      runner: fakeRunner({ type: "result", is_error: true, result: "rate limited" }),
    });
    await expect(be.complete({ prompt: "x" })).rejects.toThrow(/is_error|rate limited/i);
  });

  it("passes system prompt and model tier through to args", async () => {
    const seen: string[][] = [];
    const be = new SubscriptionBackend({
      model: { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-5" },
      runner: async (_bin, args, _input) => {
        seen.push(args);
        return { stdout: JSON.stringify({ result: "{}" }), stderr: "", exitCode: 0 };
      },
    });
    await be.complete({ prompt: "p", system: "sys", tier: "smart" });
    const args = seen[0];
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("sys");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-5");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });
});

describe("describeRunnerError", () => {
  it("reports a clear message when the claude binary is missing (ENOENT)", () => {
    const err: RunnerErrorLike = { code: "ENOENT" };
    expect(describeRunnerError(err)).toMatch(/claude cli not found on path/i);
  });
  it("reports a clear message when the process was killed by timeout", () => {
    const err: RunnerErrorLike = { killed: true };
    expect(describeRunnerError(err)).toMatch(/timed out after 180s/i);
  });
  it("reports a clear message when the process exited via signal (timeout kill)", () => {
    const err: RunnerErrorLike = { signal: "SIGTERM" };
    expect(describeRunnerError(err)).toMatch(/timed out after 180s/i);
  });
  it("returns undefined for no error", () => {
    expect(describeRunnerError(null)).toBeUndefined();
  });
  it("returns undefined for an ordinary non-zero exit (no special mapping)", () => {
    const err: RunnerErrorLike = { code: 1 };
    expect(describeRunnerError(err)).toBeUndefined();
  });
});
