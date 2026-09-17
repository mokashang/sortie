import { describe, expect, it } from "vitest";
import { OpenAiBackend, responseText } from "@/llm/backends/openai";

describe("OpenAiBackend", () => {
  it("calls Responses API and joins every output_text part", async () => {
    const request: { url: string; init: RequestInit } = { url: "", init: {} };
    const backend = new OpenAiBackend({
      apiKey: "sk-secret",
      model: { fast: "gpt-fast", smart: "gpt-smart" },
      fetch: async (url, init) => {
        request.url = url;
        request.init = init;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":" }, { type: "output_text", text: "true}" }] }] }),
        };
      },
    });
    const result = await backend.complete({ system: "JSON only", prompt: "go", tier: "smart", maxTokens: 200 });
    expect(result.text).toBe('{"ok":true}');
    expect(result.backend).toBe("openai");
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(request.init.body));
    expect(body).toMatchObject({ model: "gpt-smart", instructions: "JSON only", input: "go", max_output_tokens: 200, store: false });
    expect((request.init.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
  });

  it("does not assume text is the first output item", () => {
    expect(responseText({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "answer" }] }] })).toBe("answer");
  });

  it("requires key and model without leaking a key", async () => {
    await expect(new OpenAiBackend({ env: {}, fetch: async () => { throw new Error("unused"); } }).complete({ prompt: "x" })).rejects.toThrow(/OPENAI_API_KEY/);
    await expect(new OpenAiBackend({ apiKey: "sk-secret", env: {}, fetch: async () => { throw new Error("unused"); } }).complete({ prompt: "x" })).rejects.toThrow(/OPENAI_MODEL/);
  });
});
