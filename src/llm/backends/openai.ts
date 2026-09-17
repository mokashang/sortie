import type { LlmBackend, LlmRequest, LlmResult } from "@/llm/types";
import type { EnvMap } from "@/ai/config";

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type OpenAiFetch = (url: string, init: RequestInit) => Promise<FetchResponseLike>;

interface ResponseEnvelope {
  id?: string;
  error?: { message?: string };
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}

export interface OpenAiBackendOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: { fast?: string; smart?: string };
  fetch?: OpenAiFetch;
  env?: EnvMap;
}

export function responseText(envelope: ResponseEnvelope): string {
  return (envelope.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim();
}

// Direct Responses API backend for matching, deduping, drafting, resume selection and every
// other prompt-only task. Agentic browser runs use the same API key through Codex CLI (see
// src/ai/runtime.ts), which keeps one safety/approval protocol for both providers.
export class OpenAiBackend implements LlmBackend {
  readonly name = "openai";
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: { fast?: string; smart?: string };
  private readonly fetcher: OpenAiFetch;

  constructor(opts: OpenAiBackendOptions = {}) {
    const env = opts.env ?? process.env;
    this.apiKey = opts.apiKey ?? env.OPENAI_API_KEY;
    this.baseUrl = (opts.baseUrl ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model =
      opts.model ??
      ({
        fast: env.OPENAI_FAST_MODEL || env.OPENAI_MODEL,
        smart: env.OPENAI_SMART_MODEL || env.OPENAI_MODEL,
      } satisfies { fast?: string; smart?: string });
    this.fetcher = opts.fetch ?? (globalThis.fetch as unknown as OpenAiFetch);
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    if (!this.apiKey) throw new Error("openai backend: OPENAI_API_KEY is not configured");
    const model = req.tier === "smart" ? this.model.smart : this.model.fast;
    if (!model) throw new Error("openai backend: set OPENAI_MODEL (or OPENAI_FAST_MODEL / OPENAI_SMART_MODEL)");
    const body: Record<string, unknown> = { model, input: req.prompt, store: false };
    if (req.system) body.instructions = req.system;
    if (req.maxTokens) body.max_output_tokens = req.maxTokens;
    const response = await this.fetcher(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const rawText = await response.text();
    let envelope: ResponseEnvelope;
    try {
      envelope = JSON.parse(rawText) as ResponseEnvelope;
    } catch {
      throw new Error(`openai backend: invalid JSON response (${response.status}): ${rawText.slice(0, 300)}`);
    }
    if (!response.ok) throw new Error(`openai backend: HTTP ${response.status}: ${envelope.error?.message ?? rawText.slice(0, 300)}`);
    const text = responseText(envelope);
    if (!text) throw new Error(`openai backend: response contained no output_text (response ${envelope.id ?? "unknown"})`);
    return { text, backend: this.name, raw: envelope };
  }
}
