import { execFile, spawn } from "child_process";
import { LlmBackend, LlmRequest, LlmResult } from "@/llm/types";
import { resolveClaudeBin } from "@/lib/claude-bin";

// 真实执行器:调用本机 `claude` CLI 的无头模式。prompt 走 stdin,避免超长命令行。
export type Runner = (
  bin: string,
  args: string[],
  input: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

// Streaming variant: the runner hands every stdout line to `onLine` as it arrives instead of
// buffering the whole output (claude -p --output-format stream-json prints one JSON event per line).
export type StreamRunner = (
  bin: string,
  args: string[],
  input: string,
  onLine: (line: string) => void
) => Promise<{ stderr: string; exitCode: number }>;

// Minimal shape we read off an execFile callback error — deliberately narrower than
// Node's ExecFileException so this stays a small, easily-testable pure function.
export interface RunnerErrorLike {
  code?: string | number | null;
  killed?: boolean;
  signal?: string | null;
}

// Maps a raw execFile callback error to a clear diagnostic, distinguishing the two
// silent-failure modes that both otherwise collapse into a blank "exited 1: " message:
// the CLI missing from PATH (ENOENT) and the process being killed on timeout.
// Exported as a pure function so it's unit-testable without spawning a real process
// (triggering a real ENOENT or a real 180s timeout in a fast unit test isn't practical).
export function describeRunnerError(err: RunnerErrorLike | null): string | undefined {
  if (!err) return undefined;
  if (err.code === "ENOENT") return "claude CLI not found on PATH (set CLAUDE_BIN)";
  if (err.killed || err.signal) return "claude timed out after 180s";
  return undefined;
}

const TIMEOUT_MS = 180_000;

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // A machine may have GPT mode configured while Claude is selected. The Claude subprocess
  // never needs OpenAI credentials, so do not let untrusted prompt text reach them through a
  // model-invoked shell command.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

const defaultRunner: Runner = (bin, args, input) =>
  new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      // windowsHide: a console-less parent (pm2-managed server) would otherwise get a blank
      // console window per call on Windows — hundreds per hour during a matching pass.
      { maxBuffer: 32 * 1024 * 1024, timeout: TIMEOUT_MS, windowsHide: true, env: childEnv() },
      (err, stdout, stderr) => {
        const mapped = describeRunnerError(err as RunnerErrorLike | null);
        resolve({
          stdout: stdout ?? "",
          stderr: mapped ?? stderr ?? "",
          exitCode: err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0,
        });
      }
    );
    child.stdin?.end(input);
  });

// spawn (not execFile) so stdout can be consumed line by line while the model is still writing.
const defaultStreamRunner: StreamRunner = (bin, args, input, onLine) =>
  new Promise((resolve) => {
    let stderr = "";
    let buffered = "";
    let settled = false;
    const finish = (r: { stderr: string; exitCode: number }) => {
      if (settled) return;
      settled = true;
      if (buffered.trim()) onLine(buffered);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { windowsHide: true, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ stderr: describeRunnerError(e as RunnerErrorLike) ?? String(e), exitCode: 1 });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ stderr: describeRunnerError({ killed: true }) ?? "timed out", exitCode: 1 });
    }, TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffered += chunk;
      let nl = buffered.indexOf("\n");
      while (nl >= 0) {
        const line = buffered.slice(0, nl).replace(/\r$/, "");
        buffered = buffered.slice(nl + 1);
        if (line.trim()) onLine(line);
        nl = buffered.indexOf("\n");
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8000) stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ stderr: describeRunnerError(err as RunnerErrorLike) ?? String(err), exitCode: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ stderr, exitCode: code ?? 1 });
    });
    child.stdin?.on("error", () => {
      // the CLI exited before reading its input; `close` reports the exit code
    });
    child.stdin?.end(input);
  });

interface ClaudeEnvelope {
  result?: string;
  is_error?: boolean;
  subtype?: string;
}

// One line of `--output-format stream-json --include-partial-messages` output, reduced to what
// the chat needs: a piece of answer text, the final envelope, or nothing (init / thinking /
// usage / rate-limit events). Pure and exported so the parsing is unit-testable.
export type StreamLine = { kind: "delta"; text: string } | { kind: "result"; envelope: ClaudeEnvelope } | null;

export function parseStreamLine(line: string): StreamLine {
  let ev: {
    type?: string;
    event?: { type?: string; delta?: { type?: string; text?: string } };
    result?: string;
    is_error?: boolean;
    subtype?: string;
  };
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (ev.type === "stream_event") {
    const e = ev.event;
    if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string") {
      return { kind: "delta", text: e.delta.text };
    }
    return null;
  }
  if (ev.type === "result") return { kind: "result", envelope: { result: ev.result, is_error: ev.is_error, subtype: ev.subtype } };
  return null;
}

export interface SubscriptionOptions {
  bin?: string;                                  // 默认 "claude"(依赖 PATH)
  model?: { fast: string; smart: string };
  runner?: Runner;
  streamRunner?: StreamRunner;
}

export class SubscriptionBackend implements LlmBackend {
  readonly name = "subscription";
  private bin: string;
  private model: { fast: string; smart: string };
  private runner: Runner;
  private streamRunner: StreamRunner;

  constructor(opts: SubscriptionOptions = {}) {
    // Same resolution as the executor: CLAUDE_BIN → ~/.local/bin/claude → PATH. The launchd
    // server's PATH does not include ~/.local/bin, so a bare "claude" fails there.
    this.bin = opts.bin ?? resolveClaudeBin();
    this.model = opts.model ?? { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-5" };
    this.runner = opts.runner ?? defaultRunner;
    this.streamRunner = opts.streamRunner ?? defaultStreamRunner;
  }

  private args(req: LlmRequest, output: "json" | "stream-json"): string[] {
    const args = [
      "-p",
      "--output-format",
      output,
      "--no-session-persistence",
      "--model",
      req.tier === "smart" ? this.model.smart : this.model.fast,
      // Pure text completion: ignore every MCP configuration on the machine so this short-lived
      // process boots no MCP servers (it used to inherit the user's playwright + hanzi-browse
      // entries and spawn both, six at a time during a matching pass).
      "--strict-mcp-config",
    ];
    if (output === "stream-json") args.push("--verbose", "--include-partial-messages");
    if (req.bare) {
      // Bare mode (LlmRequest.bare): our system prompt is the whole system prompt, no built-in
      // tools, and no settings / CLAUDE.md / skills from the user or the working directory.
      args.push("--system-prompt", req.system ?? "", "--tools", "", "--setting-sources", "");
    } else if (req.system) {
      args.push("--append-system-prompt", req.system);
    }
    return args;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const { stdout, stderr, exitCode } = await this.runner(this.bin, this.args(req, "json"), req.prompt);
    if (exitCode !== 0) {
      throw new Error(`subscription backend: claude exited ${exitCode}: ${stderr.slice(0, 300)}`);
    }
    let env: ClaudeEnvelope;
    try {
      env = JSON.parse(stdout) as ClaudeEnvelope;
    } catch {
      throw new Error(`subscription backend: could not parse claude envelope: ${stdout.slice(0, 200)}`);
    }
    return this.fromEnvelope(env, stdout);
  }

  async stream(req: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult> {
    let envelope: ClaudeEnvelope | null = null;
    let streamed = "";
    const { stderr, exitCode } = await this.streamRunner(this.bin, this.args(req, "stream-json"), req.prompt, (line) => {
      const parsed = parseStreamLine(line);
      if (!parsed) return;
      if (parsed.kind === "delta") {
        streamed += parsed.text;
        onDelta(parsed.text);
      } else {
        envelope = parsed.envelope;
      }
    });
    if (exitCode !== 0) {
      throw new Error(`subscription backend: claude exited ${exitCode}: ${stderr.slice(0, 300)}`);
    }
    if (!envelope) {
      // The CLI ended without its result line (killed mid-way); the streamed text is all we have.
      if (streamed) return { text: streamed, backend: this.name };
      throw new Error(`subscription backend: stream ended without a result: ${stderr.slice(0, 200)}`);
    }
    return this.fromEnvelope(envelope, streamed);
  }

  private fromEnvelope(env: ClaudeEnvelope, raw: string): LlmResult {
    if (env.is_error) {
      throw new Error(`subscription backend: claude reported error: ${String(env.result).slice(0, 300)}`);
    }
    if (typeof env.result !== "string") {
      throw new Error(`subscription backend: envelope missing result field: ${raw.slice(0, 200)}`);
    }
    return { text: env.result, backend: this.name, raw: env };
  }
}
