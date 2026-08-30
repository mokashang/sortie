import crypto from "crypto";

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|co)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function fingerprint(company: string, title: string, location: string | null | undefined): string {
  return crypto.createHash("sha256").update(`${norm(company)}|${norm(title)}|${norm(location)}`).digest("hex").slice(0, 24);
}
