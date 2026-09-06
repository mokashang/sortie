import { DB, logEvent } from "@/lib/db";
import { runSweep, TickOptions } from "@/scanner/scheduler";

export interface ScanSummary {
  inserted: number;
  upgraded: number;
  duplicates: number;
  visaSkipped: number;
  locSkipped: number;
  sourceErrors: { source: string; error: string }[];
  durationMs: number;
}

// 「立即扫描」:核心层(含 6 份清单)立刻问一遍。旧的返回形状保留给 /api/scan 与 scripts/scan.ts;
// 日常的后台轮询走 scheduler.runTick(每分钟一跳,见 instrumentation.ts → /api/scan/tick)。
export async function runScan(db: DB, opts: TickOptions = {}): Promise<ScanSummary> {
  const t = await runSweep(db, { tiers: ["core"], ...opts });
  const summary: ScanSummary = {
    inserted: t.inserted,
    upgraded: t.upgraded,
    duplicates: t.duplicates,
    visaSkipped: t.visaSkipped,
    locSkipped: t.locSkipped,
    sourceErrors: t.errors.map((e) => ({ source: e.key, error: e.error })),
    durationMs: t.durationMs,
  };
  logEvent(db, "scan_done", { entity: "scanner", payload: summary });
  return summary;
}
