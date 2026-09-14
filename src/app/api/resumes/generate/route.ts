import { NextResponse } from "next/server";
import { resumesDir } from "@/lib/paths";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { getBackend } from "@/llm/registry";
import { generateResume, isSafeVersionName } from "@/resume/generate";
import { makeTectonicCompiler } from "@/resume/compile";
import { isKnownDirection } from "@/matcher/directions";

export async function POST(req: Request) {
  const { direction, versionName } = await req.json();
  if (!isKnownDirection(direction)) return NextResponse.json({ error: "unknown direction" }, { status: 400 });
  const name = (versionName && String(versionName)) || `${direction}_${Date.now()}`;
  if (!isSafeVersionName(name)) return NextResponse.json({ error: "invalid version name" }, { status: 400 });
  const p = loadProfile();
  try {
    const res = await generateResume(getDb(), {
      backend: getBackend(),
      contact: { name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin, github: p.github },
      direction,
      versionName: name,
      compile: makeTectonicCompiler(),
      outDir: resumesDir(),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
