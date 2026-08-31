import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { updateExperience, deleteExperience, ExperienceInputSchema } from "@/resume/experiences";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = ExperienceInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  updateExperience(getDb(), Number(id), parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteExperience(getDb(), Number(id));
  return NextResponse.json({ ok: true });
}
