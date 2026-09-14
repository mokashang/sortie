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

// Drop-in replacement for `await req.json()` in the route handlers the session posts to.
export async function readJsonBody<T = any>(req: Request): Promise<T> {
  return JSON.parse(decodeRequestText(new Uint8Array(await req.arrayBuffer()))) as T;
}
