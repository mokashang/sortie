import type { DB } from "@/lib/db";

// May accounts other than the owner run apply tasks in the background browser? (2026-10-22)
//
// The security review of the same day made the background browser owner-only: a background run
// is an agent process on this machine with the owner's AI provider, a shell and the repo as its
// working directory. The same day the owner's brother signed up and could not apply at all — the
// box's Chrome is the owner's, so the background browser is the only way another account's
// applications get filled. Both are the owner's call, so it is a switch on 设置 (owner only),
// on by default: the server is reachable on the owner's tailnet only, so whoever signs up is
// someone the owner let in. What the review fixed stays fixed either way: agent processes start
// without the server's secrets and cannot read them, run tokens cannot approve anything, and
// another account's reports never touch the shared job data.

const KEY = "members_background";

export function membersMayUseBackground(db: DB): boolean {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row?.value !== "false";
}

export function setMembersMayUseBackground(db: DB, allowed: boolean): void {
  db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, allowed ? "true" : "false");
}
