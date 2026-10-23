// JSON request bodies from the attended session, decoded the way they actually arrive.
//
// The session talks to the App with Git for Windows' curl from the Bash tool. curl.exe is a
// native Windows program: an *inline* body (`-d '{"line":"接单"}'`) reaches it through the
// process's ANSI code page (GBK on the production box), so the bytes on the wire are GBK; a body
// read from a file (`--data-binary @file`) is sent as-is, i.e. UTF-8. `Request.json()` decodes
// everything as UTF-8 and turned every inline Chinese character into U+FFFD — run #68's log
// (2026-09-13) is all mojibake while its file-based report/summary bodies are fine.
//
// Decode strictly as UTF-8 first and fall back to GBK only when the bytes are not valid UTF-8.
// Real UTF-8 is never misread and ASCII is identical in both encodings; the only theoretical
// miss is a GBK body whose every byte pair also happens to be well-formed UTF-8, which no real
// sentence produces. A leading UTF-8 BOM is dropped by TextDecoder, as Request.json() did.

export function decodeRequestText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gbk").decode(bytes);
  }
}

// A request the caller got wrong. withUser / failResponse (src/lib/actor.ts) answer it with a 400
// and this message, instead of the 500 an uncaught JSON.parse used to become (2026-10-15: a
// session posted `-d jobId=2090&status=…` to /api/apply/report, got a 500, and the job sat in
// 'prepared' until the 30-minute reclaim).
export class BadRequestError extends Error {
  readonly status = 400;
}

// Plenty for the biggest legitimate body (scan/ingest: ≤200 postings with their JD text).
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// The one way route handlers read a JSON body: decoded as it actually arrives (UTF-8, else GBK),
// size-capped, and refused with a 400 that says what was wrong when it is not a JSON object.
// `allowEmpty` reads an empty body as {} (routes whose fields are all optional).
export async function readJsonBody<T = any>(req: Request, opts: { allowEmpty?: boolean } = {}): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new BadRequestError("request body too large");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new BadRequestError("request body too large");
  const text = decodeRequestText(bytes);
  if (!text.trim()) {
    if (opts.allowEmpty) return {} as T;
    throw new BadRequestError("request body is empty; send a JSON object");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BadRequestError(
      /^[\w.%\[\]-]+=/.test(text.trim())
        ? "request body is form-encoded; send JSON (-H 'content-type: application/json' --data-binary @file)"
        : "request body is not valid JSON"
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError("request body must be a JSON object");
  return value as T;
}
