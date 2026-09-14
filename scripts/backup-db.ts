import path from "path";
import { backupDatabase } from "../src/lib/backup";
import { dataDir } from "../src/lib/paths";

// Daily database backup. Windows: the `Sortie Backup` scheduled task runs this at 04:00
// (ops/windows/setup.ps1); anywhere: `npm run backup`. Online snapshot — the server keeps running.
async function main() {
  const dir = dataDir();
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 14);
  const r = await backupDatabase({ src: path.join(dir, "jobseeker.db"), outDir: path.join(dir, "backups"), keepDays });
  console.log(`backup written: ${r.dest} (${(r.bytes / 1024 / 1024).toFixed(1)} MB); pruned ${r.pruned.length}: ${r.pruned.join(", ") || "-"}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
