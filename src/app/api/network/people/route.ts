import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listPeople, upsertPerson, PersonInputSchema } from "@/network/crm";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const company = url.searchParams.get("company") ?? undefined;
  const relation = url.searchParams.get("relation") ?? undefined;
  try {
    return NextResponse.json({ people: listPeople(getDb(), { company, relation }) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = PersonInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    const id = upsertPerson(getDb(), parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
