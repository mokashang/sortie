import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ntfyTopicFor, setNtfyTopic, storedNtfyTopic, NTFY_TOPIC_RE } from "@/lib/notify-user";
import { notify } from "@/lib/notify";
import { withUser, failResponse } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";
import { langFromRequest, messagesFor } from "@/i18n/server";

// 设置 → 通知: the account's own ntfy channel (src/lib/notify-user.ts).
//   POST {topic}       -> save it ("" clears it)
//   POST {test: true}  -> push a test message to wherever this account's pushes go
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = (await readJsonBody(req)) as { topic?: unknown; test?: unknown };
    const db = getDb();
    const t = messagesFor(langFromRequest(req)).settings.notifications;
    if (body.test === true) {
      if (!ntfyTopicFor(db, userId)) return NextResponse.json({ error: t.noChannel }, { status: 400 });
      await notify(t.testTitle, t.testBody, { account: { db, userId } });
      return NextResponse.json({ ok: true });
    }
    if (typeof body.topic !== "string") return NextResponse.json({ error: "topic must be a string" }, { status: 400 });
    const topic = body.topic.trim();
    if (topic && !NTFY_TOPIC_RE.test(topic)) return NextResponse.json({ error: t.invalidChannel }, { status: 400 });
    setNtfyTopic(db, userId, topic || null);
    return NextResponse.json({ ok: true, topic: storedNtfyTopic(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
