// Thin fetch helpers: JSON in/out, non-2xx → ApiError carrying the server's `error` message.
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// A 401 from any API means the session is gone (expired, signed out elsewhere): go to /login
// and come back to the page afterwards. Guarded so it fires once per page, not once per poll.
let redirecting = false;
function onUnauthenticated(): void {
  if (typeof window === "undefined" || redirecting) return;
  if (window.location.pathname.startsWith("/login")) return;
  redirecting = true;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}

async function handle<T>(r: Response): Promise<T> {
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    if (r.status === 401) onUnauthenticated();
    const msg = typeof j.error === "string" ? j.error : j.error ? JSON.stringify(j.error) : `HTTP ${r.status}`;
    throw new ApiError(msg, r.status, typeof j.code === "string" ? j.code : undefined);
  }
  return j as T;
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function getJson<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { cache: "no-store" }));
}

export async function postJson<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  return handle<T>(await fetch(url, { method: "POST", headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }));
}

export async function putJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  return handle<T>(await fetch(url, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body) }));
}

export async function patchJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  return handle<T>(await fetch(url, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) }));
}

export async function deleteJson<T = Record<string, unknown>>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { method: "DELETE" }));
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
