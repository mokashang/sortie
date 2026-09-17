import { describe, it, expect } from "vitest";
import { getBackend, registerBackend } from "@/llm/registry";
import { LlmBackend } from "@/llm/types";

const fake: LlmBackend = { name: "fake", complete: async () => ({ text: "{}", backend: "fake" }) };

describe("llm registry", () => {
  it("returns the subscription backend by default", () => {
    const be = getBackend();
    expect(be.name).toBe("subscription");
  });
  it("returns a named backend when configured", () => {
    registerBackend(fake);
    expect(getBackend("fake").name).toBe("fake");
  });
  it("registers both OpenAI choices", () => {
    expect(getBackend("codex").name).toBe("codex");
    expect(getBackend("openai").name).toBe("openai");
  });
  it("throws for an unknown backend name", () => {
    expect(() => getBackend("nope")).toThrow(/unknown llm backend/i);
  });
});
