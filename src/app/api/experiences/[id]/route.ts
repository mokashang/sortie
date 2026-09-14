import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { updateExperience, deleteExperience, ExperienceInputSchema } from "@/resume/experiences";
import { withUser, failResponse } from "@/lib/actor";

export const PUT = withUser(async (req, { userId }, { params }) => {
  const { id } = await params;
  const body = await req.json();
  const parsed = ExperienceInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    updateExperience(getDb(), userId, Number(id), parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e, 404);
  }
});

export const DELETE = withUser(async (_req, { userId }, { params }) => {
  const { id } = await params;
  deleteExperience(getDb(), userId, Number(id));
  return NextResponse.json({ ok: true });
});
