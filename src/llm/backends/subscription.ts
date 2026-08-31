import { execFile } from "child_process";
import { LlmBackend, LlmRequest, LlmResult } from "@/llm/types";

// 真实执行器:调用本机 `claude` CLI 的无头模式。prompt 走 stdin,避免超长命令行。
export type Runner = (
  bin: string,
  args: string[],
  input: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const defaultRunner: Runner = (bin, args, input) =>
  new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      { maxBuffer: 32 * 1024 * 1024, timeout: 180_000 },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
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
    this.bin = opts.bin ?? process.env.CLAUDE_BIN ?? "claude";
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
