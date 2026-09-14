import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfileData, saveStandardAnswers } from "@/lib/profile";
import { withUser, failResponse } from "@/lib/actor";

// The /profile 标准答案 editor. GET returns the current map; PUT {answers: {key: value}}
// replaces it on the account's stored profile (see saveStandardAnswers). These answers are what
// the apply executor's answer pack exposes as `custom`, so anything the user adds here is
// available to the next fill — the "all interaction in the App" rule.
export const GET = withUser(async (_req, { userId }) => {
  const answers = (getProfileData(getDb(), userId)?.standard_answers ?? {}) as Record<string, string>;
  return NextResponse.json({ answers });
});

export const PUT = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    if (!body || typeof body.answers !== "object" || Array.isArray(body.answers)) {
      return NextResponse.json({ error: "answers must be an object" }, { status: 400 });
    }
    const answers = saveStandardAnswers(getDb(), userId, body.answers);
    return NextResponse.json({ ok: true, answers });
  } catch (e) {
    return failResponse(e);
  }
});
