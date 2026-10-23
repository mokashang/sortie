import path from "path";
import { loadEnvConfig } from "@next/env";
import { backupDatabase, mirrorBackup } from "../src/lib/backup";
import { dataDir } from "../src/lib/paths";

// Daily database backup. Windows: the `Sortie Backup` scheduled task runs this at 04:00
// (ops/windows/setup.ps1); anywhere: `npm run backup`. Online snapshot — the server keeps running.
async function main() {
  // The scheduled task runs this outside Next, so read .env the way the server does (DATA_DIR,
  // BACKUP_* settings).
  loadEnvConfig(process.cwd());
  const dir = dataDir();
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 14);
  const r = await backupDatabase({ src: path.join(dir, "jobseeker.db"), outDir: path.join(dir, "backups"), keepDays });
  console.log(`backup written: ${r.dest} (${(r.bytes / 1024 / 1024).toFixed(1)} MB); pruned ${r.pruned.length}: ${r.pruned.join(", ") || "-"}`);
  const mirrorDir = process.env.BACKUP_MIRROR_DIR?.trim();
  if (mirrorDir) {
    const m = mirrorBackup(r.dest, mirrorDir, { keepDays: Number(process.env.BACKUP_MIRROR_KEEP_DAYS || 3) });
    if (m.error) console.error(`backup mirror to ${mirrorDir} FAILED: ${m.error}`);
    else console.log(`backup mirrored: ${m.dest}; pruned ${m.pruned.length}: ${m.pruned.join(", ") || "-"}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
