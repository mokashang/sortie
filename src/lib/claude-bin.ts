import fs from "fs";
import os from "os";
import path from "path";

export interface ResolveClaudeBinDeps {
  env?: Record<string, string | undefined>;
  homedir?: string;
  platform?: NodeJS.Platform;
  existsSync?: (p: string) => boolean;
}

// Shared claude CLI binary resolution: CLAUDE_BIN env → ~/.local/bin/claude (the native
// installer's location; `claude.exe` on Windows) → bare "claude" on PATH. Needed because a
// supervisor-launched server (launchd on macOS, the pm2 logon task on Windows) can have a PATH
// that does not include ~/.local/bin.
export function resolveClaudeBin(deps: ResolveClaudeBinDeps = {}): string {
  const env = deps.env ?? process.env;
  const home = deps.homedir ?? os.homedir();
  const platform = deps.platform ?? process.platform;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const candidates = [
    env.CLAUDE_BIN,
    path.join(home, ".local", "bin", "claude"),
    ...(platform === "win32" ? [path.join(home, ".local", "bin", "claude.exe")] : []),
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "claude";
}
