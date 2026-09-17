import fs from "fs";
import os from "os";
import path from "path";

export interface ResolveCodexBinDeps {
  env?: Record<string, string | undefined>;
  homedir?: string;
  platform?: NodeJS.Platform;
  existsSync?: (p: string) => boolean;
}

export function resolveCodexBin(deps: ResolveCodexBinDeps = {}): string {
  const env = deps.env ?? process.env;
  if (env.CODEX_BIN?.trim()) return env.CODEX_BIN.trim();
  const home = deps.homedir ?? os.homedir();
  const platform = deps.platform ?? process.platform;
  const exists = deps.existsSync ?? fs.existsSync;
  const candidates = [
    path.join(home, ".local", "bin", platform === "win32" ? "codex.exe" : "codex"),
    ...(platform === "win32"
      ? [path.join(home, "AppData", "Roaming", "npm", "codex.cmd"), path.join(home, "AppData", "Roaming", "npm", "codex.exe")]
      : []),
  ];
  return candidates.find(exists) ?? "codex";
}
