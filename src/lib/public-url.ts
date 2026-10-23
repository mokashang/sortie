import dns from "node:dns/promises";
import net from "node:net";

// Server-side fetches of URLs that came from outside (a link pasted into 问助手, a posting the
// chat model wants read) must stay on the public internet. Without this the server would fetch
// http://127.0.0.1:…, the tailnet's other machines (100.64.0.0/10) or the router's admin page on
// the caller's behalf and hand the page text back to them.

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT — Tailscale addresses live here
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind === 6) {
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (v6 === "::" || v6 === "::1") return true;
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return v4Private(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
  }
  return false;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".ts.net"];

// Cheap checks that need no DNS: scheme, credentials, IP literals, local names.
export function publicUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "only http(s) URLs";
  if (u.username || u.password) return "URLs with credentials are not fetched";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || (!host.includes(".") && net.isIP(host) === 0)) return "local host name";
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return "local host name";
  if (net.isIP(host) && isPrivateAddress(host)) return "private address";
  return null;
}

async function resolvesPrivate(host: string): Promise<boolean> {
  if (net.isIP(host)) return isPrivateAddress(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.some((a) => isPrivateAddress(a.address));
  } catch {
    return false; // unresolvable: the fetch itself fails
  }
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// fetch() that refuses non-public targets, re-checking every redirect hop (a public page may
// redirect to http://127.0.0.1). `resolveDns` also rejects public names that resolve to a
// private address; tests pass a fake fetcher and skip it.
export async function fetchPublic(
  url: string,
  init: RequestInit = {},
  opts: { fetcher?: Fetcher; resolveDns?: boolean; maxRedirects?: number } = {}
): Promise<Response> {
  const fetcher = opts.fetcher ?? fetch;
  const resolveDns = opts.resolveDns ?? opts.fetcher === undefined;
  let current = url;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const problem = publicUrlProblem(current);
    if (problem) throw new Error(`refused ${problem}`);
    if (resolveDns && (await resolvesPrivate(new URL(current).hostname.replace(/^\[|\]$/g, "")))) throw new Error("refused private address");
    const res = await fetcher(current, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    current = new URL(location, current).toString();
  }
  throw new Error("too many redirects");
}
