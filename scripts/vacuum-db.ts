import fs from "fs";
import os from "os";
import path from "path";
import { openDb, logEvent } from "../src/lib/db";
import { dataDir } from "../src/lib/paths";

// Compacts data/jobseeker.db. Run by hand with the server stopped, never by the server itself:
//   pm2 stop sortie; npm run vacuum-db; pm2 restart sortie
// (restart, not start: it brings the stopped app back with the environment pm2 stored for it.)
// VACUUM rewrites the whole file — it builds a compact copy in the temp folder, copies it back
// through the WAL and holds the write lock throughout — so it needs about the db's size free on
// both drives, and a running server's writes would fail for the duration. The v19 move
// (migrateV19 in src/lib/db.ts) reuses the pages it frees, so afterwards there is little free
// space to give back; what this buys is each table's pages back in file order. Refuses while the
// server answers on its port or a drive is short of room; --force skips both checks.

const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

async function serverAnswers(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${process.env.PORT || "3000"}/api/executor/status`, { signal: AbortSignal.timeout(3000) });
    return true; // any HTTP answer, 401 included, means it is up
  } catch {
    return false;
  }
}

function freeBytes(dir: string): number {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
}

async function main() {
  const file = path.join(dataDir(), "jobseeker.db");
  const force = process.argv.includes("--force");
  if (!fs.existsSync(file)) throw new Error(`no database at ${file}`);
  if (!force && (await serverAnswers())) {
    console.error("vacuum-db: the server is running. Stop it first (pm2 stop sortie), then run this again.");
    process.exit(1);
  }
  const size = fs.statSync(file).size;
  for (const [what, dir] of [["database drive", path.dirname(file)], ["temp folder", os.tmpdir()]] as const) {
    const free = freeBytes(dir);
    console.log(`vacuum-db: ${what} ${dir}: ${mb(free)} free`);
    if (!force && free < size * 1.1) {
      console.error(`vacuum-db: VACUUM needs about ${mb(size)} free on the ${what}; free some space or pass --force.`);
      process.exit(1);
    }
  }

  const db = openDb(file);
  const pages = db.pragma("page_count", { simple: true }) as number;
  const freePages = db.pragma("freelist_count", { simple: true }) as number;
  const pageSize = db.pragma("page_size", { simple: true }) as number;
  console.log(`vacuum-db: ${file} is ${mb(size)}, ${mb(freePages * pageSize)} of it free pages (${freePages} of ${pages}); vacuuming…`);
  const started = Date.now();
  db.exec("VACUUM");
  db.pragma("wal_checkpoint(TRUNCATE)");
  const after = fs.statSync(file).size;
  const seconds = (Date.now() - started) / 1000;
  logEvent(db, "db_vacuum", { payload: { before: size, after, seconds } });
  db.close();
  console.log(`vacuum-db: done in ${seconds.toFixed(1)} s, ${mb(size)} → ${mb(after)}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
