import fs from "fs";
import os from "os";
import path from "path";

// Shared claude CLI binary resolution: CLAUDE_BIN env → ~/.local/bin/claude → bare "claude"
// on PATH. Needed because the launchd-managed server process has a minimal PATH that does
// not include ~/.local/bin, where the claude CLI is installed on this machine.
export function resolveClaudeBin(): string {
  const candidates = [process.env.CLAUDE_BIN, path.join(os.homedir(), ".local/bin/claude")].filter(
    (c): c is string => !!c
  );
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "claude";
}
