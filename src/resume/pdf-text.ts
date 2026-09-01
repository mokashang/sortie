import { execFile } from "child_process";

export type PdftotextExec = (pdfPath: string) => Promise<string>;

const defaultExec: PdftotextExec = (pdfPath) =>
  new Promise((resolve, reject) => {
    execFile(
      "pdftotext",
      ["-layout", pdfPath, "-"],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
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
