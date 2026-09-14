import crypto from "crypto";
import fs from "fs";
import path from "path";

// The box's own credential (spec 2026-09-13 accounts §2): the server's loopback callers
// (scheduler ticks, the attended dispatcher, deploy.ps1) and the desktop attended session on the
// same machine present it as `Authorization: Bearer <token>`. On tenant-scoped routes it acts as
// the OWNER account. Comes from SORTIE_INTERNAL_TOKEN when set; otherwise it is generated once and
// kept in data/internal-token (owner-only file mode where the OS honours it) so every local
// process reads the same value with `cat data/internal-token`.

export function internalTokenPath(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "internal-token");
}

let cached: string | null = null;

export function getInternalToken(): string {
  if (cached) return cached;
  const fromEnv = process.env.SORTIE_INTERNAL_TOKEN?.trim();
  const file = internalTokenPath();
  if (fromEnv) {
    cached = fromEnv;
    // Keep the file in sync so local tools can always read it, whichever way it was configured.
    try {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8").trim() !== fromEnv) writeTokenFile(file, fromEnv);
    } catch {
      /* read-only data dir: the env value still works */
    }
    return cached;
  }
  try {
    const onDisk = fs.readFileSync(file, "utf8").trim();
    if (onDisk.length >= 32) {
      cached = onDisk;
      return cached;
    }
  } catch {
    /* not there yet */
  }
  const fresh = `sortie_internal_${crypto.randomBytes(24).toString("base64url")}`;
  writeTokenFile(file, fresh);
  cached = fresh;
  return cached;
}

function writeTokenFile(file: string, token: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
}

// Constant-time comparison so a presented token can't be guessed byte by byte.
export function isInternalToken(presented: string): boolean {
  const expected = getInternalToken();
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function resetInternalTokenCacheForTests(): void {
  cached = null;
}
