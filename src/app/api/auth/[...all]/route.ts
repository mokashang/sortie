import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Every Better Auth endpoint (sign-in/up, sessions, verification, reset, OAuth callbacks) is
// served here: /api/auth/*. The instance is created on first request (src/lib/auth.ts).
export const dynamic = "force-dynamic";

const handler = toNextJsHandler((req: Request) => getAuth().handler(req));
export const { GET, POST } = handler;
