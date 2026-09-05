// Process-wide "a matching pass is running" lock shared by every trigger point (scan chain,
// jd_review finish chain). Hung on globalThis like getDb() so Next dev HMR / separate route
// module instances all see the same flag.
const g = globalThis as unknown as { __jsMatchingInFlight?: boolean };

export function tryAcquireMatching(): boolean {
  if (g.__jsMatchingInFlight) return false;
  g.__jsMatchingInFlight = true;
  return true;
}

export function releaseMatching(): void {
  g.__jsMatchingInFlight = false;
}

export function isMatchingInFlight(): boolean {
  return !!g.__jsMatchingInFlight;
}
