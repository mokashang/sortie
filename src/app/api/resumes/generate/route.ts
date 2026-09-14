import { NextResponse } from "next/server";
import path from "path";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { getBackend } from "@/llm/registry";
import { generateResume, isSafeVersionName } from "@/resume/generate";
import { makeTectonicCompiler } from "@/resume/compile";
import { isKnownDirection } from "@/matcher/directions";
import { dataDir, ownerId, userDataDir } from "@/lib/users";
import { withUser, failResponse } from "@/lib/actor";

export const POST = withUser(async (req, { userId }) => {
  const { direction, versionName } = await req.json();
  if (!isKnownDirection(direction)) return NextResponse.json({ error: "unknown direction" }, { status: 400 });
  const name = (versionName && String(versionName)) || `${direction}_${Date.now()}`;
  if (!isSafeVersionName(name)) return NextResponse.json({ error: "invalid version name" }, { status: 400 });
  const db = getDb();
  try {
    const p = loadProfile(db, userId);
    // The owner's PDFs stay in data/resumes (where the pre-accounts versions live); every other
    // account writes under its own data/users/<id>/resumes.
    const outDir = ownerId(db) === userId ? path.join(dataDir(), "resumes") : path.join(userDataDir(userId), "resumes");
    const res = await generateResume(db, {
      userId,
      backend: getBackend(),
      contact: { name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin, github: p.github },
      direction,
      versionName: name,
      compile: makeTectonicCompiler(),
      outDir,
    });
    return NextResponse.json(res);
  } catch (e) {
    return failResponse(e, 500);
  }
});
