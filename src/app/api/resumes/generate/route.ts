import { NextResponse } from "next/server";
import path from "path";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { getBackend } from "@/llm/registry";
import { generateResume } from "@/resume/generate";
import { makeTectonicCompiler } from "@/resume/compile";
import { isKnownDirection } from "@/matcher/directions";

export async function POST(req: Request) {
  const { direction, versionName } = await req.json();
  if (!isKnownDirection(direction)) return NextResponse.json({ error: "unknown direction" }, { status: 400 });
  const name = (versionName && String(versionName)) || `${direction}_${Date.now()}`;
  const p = loadProfile();
  try {
    const res = await generateResume(getDb(), {
      backend: getBackend(),
      contact: { name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin, github: p.github },
      direction,
      versionName: name,
      compile: makeTectonicCompiler(),
      outDir: path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "resumes"),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
