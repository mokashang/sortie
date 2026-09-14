import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { messages } from "@/i18n/messages";
import { langFromCookieHeader, otherLang, parseLang } from "@/i18n/lang";

// Han, CJK punctuation and full-width forms — anything that only a Chinese string would contain.
const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/;

// The key/type outline of a message tree, so zh and en can be compared for parity.
function outline(v: unknown, prefix = ""): string[] {
  if (typeof v === "function") return [`${prefix}:fn`];
  if (v && typeof v === "object") {
    return Object.keys(v as object)
      .sort()
      .flatMap((k) => outline((v as Record<string, unknown>)[k], `${prefix}.${k}`));
  }
  return [`${prefix}:${typeof v}`];
}

// Every string a tree can produce: literals, plus the output of each function for a few
// plausible argument shapes (calls that throw because the shape is wrong are skipped).
const SAMPLE_ARGS: unknown[][] = [[1], [2], ["Stripe"], [new Date(2026, 8, 6)], [1, 2], ["Stripe", 1], ["Stripe", "x"], ["Stripe", 1, 2], [1, 2, 3], [1, 2, "rule"], [1, 2, 3, "rule"]];
function strings(v: unknown, prefix = "", out: [string, string][] = []): [string, string][] {
  if (typeof v === "string") out.push([prefix, v]);
  else if (typeof v === "function") {
    for (const args of SAMPLE_ARGS) {
      try {
        const r = (v as (...a: unknown[]) => unknown)(...args);
        // A Date handed to a function that just interpolates it echoes the machine's time-zone
        // name (possibly Chinese); only results that formatted the date count.
        if (typeof r === "string" && !args.some((a) => a instanceof Date && r.includes(String(a)))) out.push([prefix, r]);
      } catch {
        // wrong arity / argument type for this sample — fine
      }
    }
  } else if (v && typeof v === "object") {
    for (const k of Object.keys(v as object)) strings((v as Record<string, unknown>)[k], `${prefix}.${k}`, out);
  }
  return out;
}

describe("i18n messages", () => {
  it("zh and en have exactly the same keys and value kinds", () => {
    expect(outline(messages.en)).toEqual(outline(messages.zh));
  });

  it("no English string contains Chinese", () => {
    const offenders = strings(messages.en).filter(([, s]) => CJK.test(s));
    expect(offenders).toEqual([]);
  });

  it("no message is empty", () => {
    const empty = strings(messages.zh)
      .concat(strings(messages.en))
      .filter(([k, s]) => s.trim() === "" && !k.endsWith(".hint"));
    expect(empty).toEqual([]);
  });

  it("parses the cookie and the language values", () => {
    expect(parseLang("zh")).toBe("zh");
    expect(parseLang("en")).toBe("en");
    expect(parseLang("fr")).toBeNull();
    expect(parseLang(undefined)).toBeNull();
    expect(otherLang("zh")).toBe("en");
    expect(langFromCookieHeader("a=1; sortie.lang=en; b=2")).toBe("en");
    expect(langFromCookieHeader("sortie.lang=zh")).toBe("zh");
    expect(langFromCookieHeader("sortie.lang=xx")).toBeNull();
    expect(langFromCookieHeader(null)).toBeNull();
  });
});

// Every word the user can see must come from the message tree, so a hard-coded Chinese string
// anywhere in the UI layer (or the few server files whose text reaches the screen) is a bug: it
// would stay Chinese in the English version. Comments are allowed to be in any language.
const SCAN_ROOTS = ["src/app", "src/apply/stages.ts", "src/apply/funnel.ts", "src/apply/info.ts", "src/executor/runner.ts"];
const SCAN_ALLOW = new Set([
  "src/app/lib/queue-const.ts", // 未分类 is a routing sentinel (?direction=), shown through labels.unclassified
  "src/app/lib/log-steps.ts", // keyword regexes classify the assistant's Chinese log lines
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Strips // line comments (not the // inside a URL) and /* */ block comments, line by line.
function codeLines(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    let line = raw;
    let code = "";
    while (line.length > 0) {
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end < 0) {
          line = "";
          break;
        }
        inBlock = false;
        line = line.slice(end + 2);
        continue;
      }
      const block = line.indexOf("/*");
      const lineComment = line.search(/(^|[^:])\/\//);
      const lc = lineComment < 0 ? -1 : lineComment + (line[lineComment] === "/" ? 0 : 1);
      if (block >= 0 && (lc < 0 || block < lc)) {
        code += line.slice(0, block);
        inBlock = true;
        line = line.slice(block + 2);
        continue;
      }
      if (lc >= 0) {
        code += line.slice(0, lc);
        line = "";
        continue;
      }
      code += line;
      line = "";
    }
    out.push(code);
  }
  return out;
}

describe("no hard-coded Chinese in the UI layer", () => {
  it("every visible string goes through src/i18n/messages", () => {
    const root = path.resolve(__dirname, "..");
    const files = SCAN_ROOTS.flatMap((r) => {
      const p = path.join(root, r);
      return fs.statSync(p).isDirectory() ? walk(p) : [p];
    });
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (SCAN_ALLOW.has(rel)) continue;
      codeLines(fs.readFileSync(file, "utf8")).forEach((line, i) => {
        if (CJK.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
