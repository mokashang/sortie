// In-process registry of the attended session's terminal (dispatcher spec: docs/superpowers/specs/
// 2026-09-06-attended-dispatcher-design.md; the wake-up model is the 2026-09-17 change). The
// dispatcher spawns the session under node-pty and keeps the write end here so the App can *type
// into it*: an approval, a rejection, a newly queued run. That is how the session learns about
// work without polling — it fills, reports, and then simply stops at its prompt until a line
// arrives. Its tabs stay open, so an approval is submitted in the very form it filled, however
// long the user takes to click.
//
// Hung on globalThis like getDb(): Next bundles each route separately, and a module-scoped Map
// would be one Map in the dispatch route (which spawns) and another in the decide route (which
// notifies). Only the server process that spawned the child can reach it — after a server
// restart the child may still be alive but is unreachable (isAttendedReachable false), and the
// dispatcher reaps it as soon as there is something to tell it.

export interface AttendedHandle {
  pid: number;
  write(data: string): void;
}

type Registry = { handles: Map<number, AttendedHandle>; notices: Map<string, number> };
const g = globalThis as unknown as { __sortieAttended?: Registry };
function reg(): Registry {
  if (!g.__sortieAttended) g.__sortieAttended = { handles: new Map(), notices: new Map() };
  return g.__sortieAttended;
}

export function registerAttendedHandle(h: AttendedHandle): void {
  reg().handles.set(h.pid, h);
}
export function unregisterAttendedHandle(pid: number): void {
  reg().handles.delete(pid);
}
export function isAttendedReachable(pid: number): boolean {
  return reg().handles.has(pid);
}
// Tests only: forget every handle and notice.
export function resetAttendedRegistry(): void {
  g.__sortieAttended = { handles: new Map(), notices: new Map() };
}

// The TUI reads the text and the Enter key as separate key events; sending both in one chunk
// risks the newline being processed before the text has been laid down.
export const ENTER_DELAY_MS = 150;

// Type one line into the session and press Enter a moment later. False when this process holds
// no terminal for that pid (never spawned here, already exited, or the server restarted).
export function writeToAttended(
  pid: number,
  line: string,
  deps: { defer?: (fn: () => void, ms: number) => void } = {}
): boolean {
  const h = reg().handles.get(pid);
  if (!h) return false;
  const text = line.replace(/[\r\n]+/g, " ").trim();
  try {
    h.write(text);
    (deps.defer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      try {
        h.write("\r");
      } catch {
        // the child went away between the two writes; the dispatcher reaps it
      }
    }, ENTER_DELAY_MS);
    return true;
  } catch {
    return false;
  }
}

// Every line the App types starts with this so the session can tell the App from page text.
// Kept ASCII: it travels through a Windows ConPTY and the terminal code page is not ours to pick.
export const NOTICE_PREFIX = "[Sortie]";
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();

export function approvedNotice(jobId: number, company: string): string {
  const who = ascii(company);
  return `${NOTICE_PREFIX} approved job ${jobId}${who ? ` (${who})` : ""}: go to the tab you filled for it, check the form still matches what you reported, click Submit, then POST /api/apply/report {jobId, status:'submitted'}. Do NOT close the tab (closing one tab destroys the whole tab group and every other filled form with it) - leave the confirmation page open or navigate that tab to about:blank. Then stop and wait for the next line.`;
}
export function rejectedNotice(jobId: number, company: string): string {
  const who = ascii(company);
  return `${NOTICE_PREFIX} rejected job ${jobId}${who ? ` (${who})` : ""}: do not submit it. Do NOT close its tab (that destroys the whole tab group) - navigate that tab to about:blank instead. The App keeps the reason for the next fill. Then stop and wait for the next line.`;
}
export function queuedRunNotice(runId: number, kind: string): string {
  return `${NOTICE_PREFIX} run ${runId} queued (${ascii(kind)}): claim it with GET /api/executor/claim-next?channel=user_chrome and carry on as usual.`;
}
export function stoppedRunNotice(runId: number): string {
  return `${NOTICE_PREFIX} run ${runId} stopped by the user: stop working on it now (do not submit anything for it), leave its tabs as they are, and wait for the next line.`;
}

// Reminder throttling for queued runs: the dispatcher tick runs every 10 s, the session should
// hear about a run once, and again only if it has not claimed it after a while.
export function noticeDue(key: string, now: number, everyMs: number): boolean {
  const last = reg().notices.get(key);
  return last == null || now - last >= everyMs;
}
export function markNotice(key: string, now: number): void {
  reg().notices.set(key, now);
}
export function clearNotices(): void {
  reg().notices.clear();
}
