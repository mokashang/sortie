import { execFile } from "child_process";
import { LlmBackend, LlmRequest, LlmResult } from "@/llm/types";
import { resolveClaudeBin } from "@/lib/claude-bin";

// 真实执行器:调用本机 `claude` CLI 的无头模式。prompt 走 stdin,避免超长命令行。
export type Runner = (
  bin: string,
  args: string[],
  input: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

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

const defaultRunner: Runner = (bin, args, input) =>
  new Promise((resolve) => {
    const env = { ...process.env };
    // A machine may have GPT mode configured while Claude is selected. The Claude subprocess
    // never needs OpenAI credentials, so do not let untrusted prompt text reach them through a
    // model-invoked shell command.
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    const child = execFile(
      bin,
      args,
      // windowsHide: a console-less parent (pm2-managed server) would otherwise get a blank
      // console window per call on Windows — hundreds per hour during a matching pass.
      { maxBuffer: 32 * 1024 * 1024, timeout: 180_000, windowsHide: true, env },
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

interface ClaudeEnvelope {
  result?: string;
  is_error?: boolean;
  subtype?: string;
}

export interface SubscriptionOptions {
  bin?: string;                                  // 默认 "claude"(依赖 PATH)
  model?: { fast: string; smart: string };
  runner?: Runner;
}

export class SubscriptionBackend implements LlmBackend {
  readonly name = "subscription";
  private bin: string;
  private model: { fast: string; smart: string };
  private runner: Runner;

  constructor(opts: SubscriptionOptions = {}) {
    // Same resolution as the executor: CLAUDE_BIN → ~/.local/bin/claude → PATH. The launchd
    // server's PATH does not include ~/.local/bin, so a bare "claude" fails there.
    this.bin = opts.bin ?? resolveClaudeBin();
    this.model = opts.model ?? { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-5" };
    this.runner = opts.runner ?? defaultRunner;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--model",
      req.tier === "smart" ? this.model.smart : this.model.fast,
      // Pure text completion: ignore every MCP configuration on the machine so this short-lived
      // process boots no MCP servers (it used to inherit the user's playwright + hanzi-browse
      // entries and spawn both, six at a time during a matching pass).
      "--strict-mcp-config",
    ];
    if (req.system) args.push("--append-system-prompt", req.system);

    const { stdout, stderr, exitCode } = await this.runner(this.bin, args, req.prompt);
    if (exitCode !== 0) {
      throw new Error(`subscription backend: claude exited ${exitCode}: ${stderr.slice(0, 300)}`);
    }
    let env: ClaudeEnvelope;
    try {
      env = JSON.parse(stdout) as ClaudeEnvelope;
    } catch {
      throw new Error(`subscription backend: could not parse claude envelope: ${stdout.slice(0, 200)}`);
    }
    if (env.is_error) {
      throw new Error(`subscription backend: claude reported error: ${String(env.result).slice(0, 300)}`);
    }
    if (typeof env.result !== "string") {
      throw new Error(`subscription backend: envelope missing result field: ${stdout.slice(0, 200)}`);
    }
    return { text: env.result, backend: this.name, raw: env };
  }
}
