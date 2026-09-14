import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { saveDocument, listDocuments, documentsMap, deleteDocument, isDocumentPath, documentExtension, isValidDocumentKey } from "@/lib/documents";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-docs-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("documents store (data/documents)", () => {
  it("saves a file under <key><ext>, lists it and exposes it as key -> absolute path", () => {
    const row = saveDocument("transcript", "Grade Report - Fall 2025.PDF", Buffer.from("%PDF-1.4 fake"), dir);
    expect(row.filename).toBe("transcript.pdf");
    expect(row.path).toBe(path.join(dir, "transcript.pdf"));
    expect(fs.readFileSync(row.path, "utf8")).toBe("%PDF-1.4 fake");
    expect(listDocuments(dir).map((d) => d.key)).toEqual(["transcript"]);
    expect(documentsMap(dir)).toEqual({ transcript: path.join(dir, "transcript.pdf") });
  });

  it("re-uploading the same key with another extension replaces the old file", () => {
    saveDocument("cover_letter", "letter.pdf", Buffer.from("a"), dir);
    const row = saveDocument("cover_letter", "letter.docx", Buffer.from("b"), dir);
    expect(row.filename).toBe("cover_letter.docx");
    expect(fs.existsSync(path.join(dir, "cover_letter.pdf"))).toBe(false);
    expect(listDocuments(dir)).toHaveLength(1);
  });

  it("rejects bad keys, unsupported types and empty files", () => {
    expect(isValidDocumentKey("transcript")).toBe(true);
    expect(isValidDocumentKey("Transcript")).toBe(false);
    expect(isValidDocumentKey("1st")).toBe(false);
    expect(isValidDocumentKey("../x")).toBe(false);
    expect(documentExtension("x.exe")).toBeNull();
    expect(documentExtension("x.JPG")).toBe(".jpg");
    expect(() => saveDocument("../etc", "a.pdf", Buffer.from("a"), dir)).toThrow(/invalid key/);
    expect(() => saveDocument("payload", "a.exe", Buffer.from("a"), dir)).toThrow(/unsupported/);
    expect(() => saveDocument("empty", "a.pdf", Buffer.alloc(0), dir)).toThrow(/empty/);
    expect(listDocuments(dir)).toEqual([]);
  });

  it("lists only well-formed files and ignores strangers in the folder", () => {
    saveDocument("portfolio", "p.pdf", Buffer.from("a"), dir);
    fs.writeFileSync(path.join(dir, "notes.md"), "x");
    fs.writeFileSync(path.join(dir, "Bad Key.pdf"), "x");
    fs.mkdirSync(path.join(dir, "sub.pdf"));
    expect(listDocuments(dir).map((d) => d.key)).toEqual(["portfolio"]);
  });

  it("deleteDocument removes the file and reports whether anything was there", () => {
    saveDocument("headshot", "me.png", Buffer.from("a"), dir);
    expect(deleteDocument("headshot", dir)).toBe(true);
    expect(deleteDocument("headshot", dir)).toBe(false);
    expect(listDocuments(dir)).toEqual([]);
  });

  it("isDocumentPath accepts only an existing file directly inside the folder", () => {
    const row = saveDocument("transcript", "t.pdf", Buffer.from("a"), dir);
    expect(isDocumentPath(row.path, dir)).toBe(true);
    expect(isDocumentPath(path.join(dir, "missing.pdf"), dir)).toBe(false);
    expect(isDocumentPath(dir, dir)).toBe(false);
    expect(isDocumentPath(path.join(dir, "..", "outside.pdf"), dir)).toBe(false);
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "nested", "deep.pdf"), "x");
    expect(isDocumentPath(path.join(dir, "nested", "deep.pdf"), dir)).toBe(false);
    expect(isDocumentPath("", dir)).toBe(false);
  });
});
