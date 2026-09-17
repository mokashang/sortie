import { execFile, type ExecFileException } from "child_process";
import { resolveCodexBin } from "@/lib/codex-bin";
import type { LlmBackend, LlmRequest, LlmResult } from "@/llm/types";
import type { EnvMap } from "@/ai/config";

export type CodexRunner = (
  bin: string,
  args: string[],
  input: string,
  env?: EnvMap
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const defaultRunner: CodexRunner = (bin, args, input, env) =>
  new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      { maxBuffer: 32 * 1024 * 1024, timeout: 180_000, windowsHide: true, encoding: "utf8", env: (env ?? process.env) as NodeJS.ProcessEnv },
      (err: ExecFileException | null, stdout: string, stderr: string) =>
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? (err ? String(err) : ""),
          exitCode: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        })
    );
    child.stdin?.end(input);
  });

export interface CodexBackendOptions {
  bin?: string;
  model?: { fast?: string; smart?: string };
  runner?: CodexRunner;
  env?: EnvMap;
}

// Pure-text backend backed by the user's saved Codex/ChatGPT login. The CLI is deliberately
// isolated from repository tools and MCP servers: callers only need prompt -> text.
export class CodexBackend implements LlmBackend {
  readonly name = "codex";
  private readonly bin: string;
  private readonly model: { fast?: string; smart?: string };
  private readonly runner: CodexRunner;
  private readonly env: EnvMap;

  constructor(opts: CodexBackendOptions = {}) {
    const sourceEnv = opts.env ?? process.env;
    this.bin = opts.bin ?? resolveCodexBin({ env: sourceEnv });
    this.env = { ...sourceEnv };
    // This backend uses saved ChatGPT/Codex auth. Never expose an unrelated API key to the
    // model process or to any shell it might try to spawn after reading untrusted JD text.
    delete this.env.OPENAI_API_KEY;
    delete this.env.CODEX_API_KEY;
    this.model = opts.model ?? { fast: this.env.CODEX_FAST_MODEL, smart: this.env.CODEX_SMART_MODEL };
    this.runner = opts.runner ?? defaultRunner;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const args = [
      "exec",
      "--ephemeral",
      "--strict-config",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "-",
    ];
    const model = req.tier === "smart" ? this.model.smart : this.model.fast;
    if (model) args.splice(args.length - 1, 0, "--model", model);
    const input = req.system ? `<system>\n${req.system}\n</system>\n\n${req.prompt}` : req.prompt;
    const { stdout, stderr, exitCode } = await this.runner(this.bin, args, input, this.env);
    if (exitCode !== 0) throw new Error(`codex backend: codex exited ${exitCode}: ${stderr.slice(0, 300)}`);
    const text = stdout.trim();
    if (!text) throw new Error(`codex backend: empty response: ${stderr.slice(0, 300)}`);
    return { text, backend: this.name };
  }
}
