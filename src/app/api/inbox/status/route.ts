import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser } from "@/lib/actor";
import { inboxStatus } from "@/inbox/sync";

export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json(inboxStatus(getDb(), userId));
});
