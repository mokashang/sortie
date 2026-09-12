import { execFile } from "child_process";

export type PdftotextExec = (pdfPath: string) => Promise<string>;

// `pdftotext` (poppler) is resolved from PATH by default; PDFTOTEXT_BIN pins an absolute path
// (Windows installs of poppler are rarely on PATH). Symmetric with TECTONIC_BIN in compile.ts.
const defaultExec: PdftotextExec = (pdfPath) =>
  new Promise((resolve, reject) => {
    execFile(
      process.env.PDFTOTEXT_BIN || "pdftotext",
      ["-layout", pdfPath, "-"],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      }
    );
  });

export interface ExtractPdfTextOptions {
  exec?: PdftotextExec;
}

// Extracts plain text from a PDF via `pdftotext -layout` (poppler), for a lightweight
// self-check on the compiled resume. If pdftotext isn't on PATH, the file doesn't exist,
// or extraction fails for any other reason, this resolves to null so callers can skip the
// content check gracefully instead of failing generation.
export async function extractPdfText(pdfPath: string, opts: ExtractPdfTextOptions = {}): Promise<string | null> {
  const exec = opts.exec ?? defaultExec;
  try {
    return await exec(pdfPath);
  } catch {
    return null;
  }
}
