import { getDb } from "../src/lib/db";
import { DIRECTORY_URL, DirectoryEntry, importDirectory } from "../src/scanner/sources/directory";

// 一次性导入开源公司目录(4700+ 家)为 longtail 板块;再跑只补新增。也可在 /sources 页点按钮。
async function main() {
  const res = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`directory: HTTP ${res.status}`);
  const raw = (await res.json()) as DirectoryEntry[] | Record<string, DirectoryEntry>;
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  const r = importDirectory(getDb(), entries, { now: new Date() });
  console.log(`directory import: ${r.inserted} boards inserted, ${r.skipped} already known (of ${entries.length} entries)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
