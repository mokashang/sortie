import { NextResponse } from "next/server";
import { loadProfile, saveStandardAnswers } from "@/lib/profile";

// The /profile 标准答案 editor. GET returns the current map; PUT {answers: {key: value}}
// replaces it in profile/profile.yaml (see saveStandardAnswers). These answers are what the
// apply executor's answer pack exposes as `custom`, so anything the user adds here is available
// to the next fill without touching the file by hand — the "all interaction in the App" rule.
export async function GET() {
  try {
    return NextResponse.json({ answers: loadProfile().standard_answers });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body.answers !== "object" || Array.isArray(body.answers)) {
      return NextResponse.json({ error: "answers must be an object" }, { status: 400 });
    }
    saveStandardAnswers(body.answers);
    return NextResponse.json({ ok: true, answers: loadProfile().standard_answers });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
