import fs from "fs";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/lib/db";
import { emptyProfileData, getProfileData, importProfileYaml, profileStatus, profileYamlPath, saveProfile } from "@/lib/profile";
import { withUser, failResponse } from "@/lib/actor";
import { langFromRequest, messagesFor } from "@/i18n/server";

// The 档案页「基本信息」editor (spec 2026-09-13 accounts §6). GET returns what is stored (or a blank
// pre-filled from the account) plus whether it validates; PUT {profile} saves a complete profile;
// POST {yaml} imports a profile.yaml text, and POST {} (owner only) imports profile/profile.yaml
// from the repo root, the pre-accounts location.
export const GET = withUser(async (_req, { userId, user }) => {
  const db = getDb();
  const data = getProfileData(db, userId) ?? emptyProfileData({ name: user?.name, email: user?.email });
  return NextResponse.json({ profile: data, status: profileStatus(db, userId) });
});

export const PUT = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    const profile = saveProfile(getDb(), userId, body.profile ?? body);
    return NextResponse.json({ ok: true, profile, status: { complete: true, exists: true, issues: [] } });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: messagesFor(langFromRequest(req)).errors.profileInvalid, issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        { status: 400 }
      );
    }
    return failResponse(e);
  }
});

export const POST = withUser(async (req, { userId, user }) => {
  try {
    const body = await req.json().catch(() => ({}));
    let yaml: string | null = typeof body.yaml === "string" && body.yaml.trim() ? body.yaml : null;
    if (!yaml) {
      const t = messagesFor(langFromRequest(req)).errors;
      if (user?.role !== "owner") return NextResponse.json({ error: t.ownerOnlyImport }, { status: 403 });
      const file = profileYamlPath();
      if (!fs.existsSync(file)) return NextResponse.json({ error: t.fileMissing(file) }, { status: 404 });
      yaml = fs.readFileSync(file, "utf8");
    }
    const profile = importProfileYaml(getDb(), userId, yaml);
    return NextResponse.json({ ok: true, profile });
  } catch (e) {
    return failResponse(e);
  }
});
