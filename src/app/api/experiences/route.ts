import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listExperiences, createExperience, ExperienceInputSchema } from "@/resume/experiences";
import { withUser } from "@/lib/actor";

export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json({ experiences: listExperiences(getDb(), userId) });
});

export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  const parsed = ExperienceInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const id = createExperience(getDb(), userId, parsed.data);
  return NextResponse.json({ id }, { status: 201 });
});
