import { execFile } from "child_process";

export interface KillTreeDeps {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  exec?: (file: string, args: string[]) => void;
}

// Terminates a detached child and everything it spawned. POSIX: SIGTERM the process group
// (negative pid — our detached children are group leaders), falling back to the bare pid when
// the group signal errors (already gone, or a fake pid in tests). Windows has no process group
// we can signal: `taskkill /T /F` kills the tree by pid instead. Never throws — callers record the
// user's intent to stop regardless of whether the OS-level kill landed.
export function killTree(pid: number, deps: KillTreeDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    const exec = deps.exec ?? ((file, args) => { execFile(file, args, () => {}); });
    exec("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return;
  }
  const kill = deps.kill ?? ((p, s) => { process.kill(p, s); });
  try {
    kill(-pid, "SIGTERM");
  } catch {
    try {
      kill(pid, "SIGTERM");
    } catch {
      // process already gone — nothing left to signal
    }
  }
}
