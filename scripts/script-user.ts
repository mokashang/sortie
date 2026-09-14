import type { DB } from "../src/lib/db";
import { getUserByEmail, ownerId, getUser, type UserRow } from "../src/lib/users";

// CLI scripts act as one account: `--user <email>` picks it, otherwise the box's owner. With no
// owner yet (nobody has signed up) there is nothing to match for, so say so plainly.
export function resolveScriptUser(db: DB, email?: string): UserRow {
  if (email) {
    const u = getUserByEmail(db, email);
    if (!u) throw new Error(`no account with email ${email}`);
    return u;
  }
  const owner = ownerId(db);
  const u = owner ? getUser(db, owner) : null;
  if (!u) throw new Error("no owner account yet — sign up in the App first, or pass --user <email>");
  return u;
}
