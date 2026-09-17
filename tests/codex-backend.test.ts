import { describe, expect, it } from "vitest";
import { CodexBackend } from "@/llm/backends/codex";

describe("CodexBackend", () => {
  it("runs an isolated ephemeral text completion and returns stdout", async () => {
    const seen: { bin: string; args: string[]; input: string }[] = [];
    const backend = new CodexBackend({
      model: { fast: "fast-model", smart: "smart-model" },
      env: { CODEX_BIN: "/codex", OPENAI_API_KEY: "must-not-leak", CODEX_API_KEY: "must-not-leak" },
      runner: async (bin, args, input, env) => {
        expect(env?.OPENAI_API_KEY).toBeUndefined();
        expect(env?.CODEX_API_KEY).toBeUndefined();
        seen.push({ bin, args, input });
        return { stdout: "{\"score\":91}\n", stderr: "", exitCode: 0 };
      },
    });
    const result = await backend.complete({ system: "Return JSON", prompt: "score", tier: "smart" });
    expect(result).toMatchObject({ text: '{"score":91}', backend: "codex" });
    expect(seen[0].bin).toBe("/codex");
    expect(seen[0].args).toContain("exec");
    expect(seen[0].args).toContain("--ephemeral");
    expect(seen[0].args).toContain("--strict-config");
    expect(seen[0].args).toContain("--ignore-user-config");
    expect(seen[0].args).toContain("smart-model");
    expect(seen[0].input).toContain("<system>\nReturn JSON");
  });

  it("surfaces CLI failures", async () => {
    const backend = new CodexBackend({ runner: async () => ({ stdout: "", stderr: "login required", exitCode: 1 }) });
    await expect(backend.complete({ prompt: "x" })).rejects.toThrow(/login required/);
  });
});
