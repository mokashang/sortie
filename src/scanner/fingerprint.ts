import crypto from "crypto";

export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(inc|llc|ltd|corp|co)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function fingerprint(company: string, title: string, location: string | null | undefined): string {
  return crypto.createHash("sha256").update(`${norm(company)}|${norm(title)}|${norm(location)}`).digest("hex").slice(0, 24);
}

// 去重分组键:公司+标题归一化,不含地点 —— 同岗多 base 落到同一组,由 consolidate.ts 交给
// Claude 判簇。与 fingerprint 不同:fingerprint 仍含地点、仍是 UNIQUE 主键,不动。
export function dedupKey(company: string, title: string): string {
  return `${norm(company)}|${norm(title)}`;
}
