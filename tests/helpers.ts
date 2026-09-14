import type { DB } from "@/lib/db";

// Test seeding for the accounts layer. Better Auth writes the "user" rows in production; tests
// insert them directly in its shape. `seedOwner(db)` makes the schema's default bucket ('legacy')
// a real owner account, so rows seeded without a user_id and functions called with U="legacy"
// line up with the owner-only paths (dispatcher, jd_review relay, browser profile dir).
export function seedUser(db: DB, id: string, email: string, opts: { name?: string; role?: "owner" | "member"; createdAt?: string } = {}): void {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?,?,?,?,?,?,?)').run(
    id, opts.name ?? id, email, 0, opts.createdAt ?? now, now, opts.role ?? "member"
  );
}

export function seedOwner(db: DB, id = "legacy", email = "owner@example.com"): string {
  seedUser(db, id, email, { name: "Owner", role: "owner" });
  return id;
}
