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
    // pure text completion: boot no MCP servers, whatever ~/.claude.json / .mcp.json say
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
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

// Bare mode and streaming (the in-app 问助手 chat, spec 2026-09-18 §5).
import { parseStreamLine } from "@/llm/backends/subscription";

describe("SubscriptionBackend bare mode", () => {
  it("replaces the system prompt and disables tools, settings and MCP", async () => {
    const seen: string[][] = [];
    const be = new SubscriptionBackend({
      runner: async (_bin, args) => {
        seen.push(args);
        return { stdout: JSON.stringify({ result: "ok" }), stderr: "", exitCode: 0 };
      },
    });
    await be.complete({ prompt: "q", system: "rules", bare: true });
    const args = seen[0];
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args).toContain("--system-prompt");
    expect(at("--system-prompt")).toBe("rules");
    expect(args).not.toContain("--append-system-prompt");
    expect(at("--tools")).toBe("");
    expect(at("--setting-sources")).toBe("");
    expect(args).toContain("--strict-mcp-config");
  });
});

describe("parseStreamLine", () => {
  it("extracts text deltas and the result envelope, ignoring everything else", () => {
    expect(parseStreamLine(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hel" } } }))).toEqual({ kind: "delta", text: "hel" });
    expect(parseStreamLine(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "…" } } }))).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "assistant", message: {} }))).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "result", result: "hello", is_error: false }))).toEqual({ kind: "result", envelope: { result: "hello", is_error: false, subtype: undefined } });
    expect(parseStreamLine("not json")).toBeNull();
  });
});

describe("SubscriptionBackend.stream", () => {
  const lines = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } }),
    JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } }),
    JSON.stringify({ type: "result", result: "Hello", is_error: false }),
  ];
  it("feeds deltas as they arrive and returns the envelope's text", async () => {
    const seenArgs: string[][] = [];
    const be = new SubscriptionBackend({
      streamRunner: async (_bin, args, _input, onLine) => {
        seenArgs.push(args);
        for (const l of lines) onLine(l);
        return { stderr: "", exitCode: 0 };
      },
    });
    const deltas: string[] = [];
    const r = await be.stream({ prompt: "p", system: "s", bare: true, tier: "smart" }, (t) => deltas.push(t));
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(r.text).toBe("Hello");
    expect(seenArgs[0]).toContain("stream-json");
    expect(seenArgs[0]).toContain("--include-partial-messages");
    expect(seenArgs[0]).toContain("--verbose");
  });
  it("throws on a non-zero exit and on an is_error envelope", async () => {
    const failing = new SubscriptionBackend({ streamRunner: async () => ({ stderr: "not logged in", exitCode: 1 }) });
    await expect(failing.stream({ prompt: "p" }, () => {})).rejects.toThrow(/not logged in/);
    const errored = new SubscriptionBackend({
      streamRunner: async (_b, _a, _i, onLine) => {
        onLine(JSON.stringify({ type: "result", result: "rate limited", is_error: true }));
        return { stderr: "", exitCode: 0 };
      },
    });
    await expect(errored.stream({ prompt: "p" }, () => {})).rejects.toThrow(/rate limited/);
  });
  it("keeps the streamed text when the CLI ends without a result line", async () => {
    const be = new SubscriptionBackend({
      streamRunner: async (_b, _a, _i, onLine) => {
        onLine(lines[1]);
        return { stderr: "", exitCode: 0 };
      },
    });
    expect((await be.stream({ prompt: "p" }, () => {})).text).toBe("Hel");
  });
});
