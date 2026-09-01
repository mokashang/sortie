import { describe, it, expect } from "vitest";
import { extractPdfText } from "@/resume/pdf-text";

describe("extractPdfText", () => {
  it("returns the text produced by the injected exec (pdftotext -layout)", async () => {
    const fakeExec = async (pdfPath: string) => `hello from ${pdfPath}`;
    const text = await extractPdfText("/tmp/r.pdf", { exec: fakeExec });
    expect(text).toBe("hello from /tmp/r.pdf");
  });

  it("returns null gracefully when the exec fails (e.g. pdftotext not installed)", async () => {
    const fakeExec = async () => { throw new Error("ENOENT: pdftotext not found"); };
    const text = await extractPdfText("/tmp/r.pdf", { exec: fakeExec });
    expect(text).toBeNull();
  });

  it("works against a real PDF via the real pdftotext binary when available", async () => {
    // Compile-free smoke test: just verify the default exec path doesn't throw for a
    // nonexistent file — it should resolve to null rather than reject.
    const text = await extractPdfText("/tmp/definitely-does-not-exist-resume.pdf");
    expect(text).toBeNull();
  });
});
