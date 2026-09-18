import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser, failResponse, requestLang } from "@/lib/actor";
import { answerChat, ChatInputError, normalizeMessages } from "@/assistant/chat";
import { chatBackend } from "@/assistant/provider";

// POST /api/assistant/chat {messages:[{role,content}]} — one turn of the in-app 问助手 chat
// (spec 2026-09-18 §6). Streams newline-delimited JSON: {"delta":"…"} as the answer arrives,
// then {"done":true,"text":"…","backend":"…"}, or {"error":"…"} if the model call failed. The
// snapshot is built for the acting account only; the model gets no tools (LlmRequest.bare).
export const POST = withUser(async (req, { userId }) => {
  let input;
  try {
    const body = (await req.json()) as { messages?: unknown };
    input = normalizeMessages(body.messages);
  } catch (e) {
    if (e instanceof ChatInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    return failResponse(e);
  }
  const lang = requestLang(req);
  const db = getDb();
  const backend = chatBackend(db, userId);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const r = await answerChat(db, userId, lang, input, { backend, onDelta: (text) => send({ delta: text }) });
        send({ done: true, text: r.text, backend: r.backend });
      } catch (e) {
        send({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
});
