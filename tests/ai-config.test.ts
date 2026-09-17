import { describe, expect, it } from "vitest";
import { getAiProvider, providerBackendName, providerStatuses, setAiProvider } from "@/ai/config";
import { openDb } from "@/lib/db";

describe("AI provider configuration", () => {
  it("keeps legacy installs on Claude until configured", () => {
    const db = openDb(":memory:");
    expect(getAiProvider(db, {})).toBe("claude");
  });

  it("persists one provider for every AI call site", () => {
    const db = openDb(":memory:");
    setAiProvider(db, "codex");
    expect(getAiProvider(db, { AI_PROVIDER: "claude" })).toBe("codex");
    expect(providerBackendName(getAiProvider(db))).toBe("codex");
    setAiProvider(db, "gpt");
    expect(providerBackendName(getAiProvider(db))).toBe("openai");
  });

  it("marks GPT unavailable until both key and model are set", () => {
    expect(providerStatuses({}).find((x) => x.provider === "gpt")?.configured).toBe(false);
    expect(providerStatuses({ OPENAI_API_KEY: "sk-test", OPENAI_FAST_MODEL: "fast-only" }).find((x) => x.provider === "gpt")?.configured).toBe(false);
    expect(providerStatuses({ OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-test" }).find((x) => x.provider === "gpt")?.configured).toBe(true);
  });
});
