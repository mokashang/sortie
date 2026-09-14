import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listPeople, upsertPerson, PersonInputSchema } from "@/network/crm";
import { withUser, failResponse } from "@/lib/actor";

export const GET = withUser(async (req, { userId }) => {
  const url = new URL(req.url);
  const company = url.searchParams.get("company") ?? undefined;
  const relation = url.searchParams.get("relation") ?? undefined;
  try {
    return NextResponse.json({ people: listPeople(getDb(), userId, { company, relation }) });
  } catch (e) {
    return failResponse(e);
  }
});

export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  const parsed = PersonInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    const id = upsertPerson(getDb(), userId, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return failResponse(e);
  }
});
