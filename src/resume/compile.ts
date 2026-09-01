import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import { Compiler, CompileResult } from "@/resume/generate";

export type Exec = (bin: string, args: string[]) => Promise<void>;

const defaultExec: Exec = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${stderr || (err as Error).message}`.slice(0, 500)));
      else resolve();
    });
  });

export interface TectonicOptions {
  bin?: string;
  exec?: Exec;
}

// Tectonic's log ends with a line like:
//   Output written on <base>.xdv (1 page, 12345 bytes).
//   Output written on <base>.xdv (2 pages, 12345 bytes).
// Parse the page count out of that line.
export function parsePageCount(log: string): number | null {
  const m = log.match(/Output written on .+\((\d+) pages?,/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

// tectonic compiles a .tex to a .pdf in an output dir. We write the tex to <outdir>/<name>.tex,
// run tectonic on it, and it emits <outdir>/<name>.pdf (plus <outdir>/<name>.log with --keep-logs).
export function makeTectonicCompiler(opts: TectonicOptions = {}): Compiler {
  const bin = opts.bin ?? process.env.TECTONIC_BIN ?? "tectonic";
  const exec = opts.exec ?? defaultExec;
  return async (tex: string, outPdfPath: string): Promise<CompileResult> => {
    const outDir = path.dirname(outPdfPath);
    const base = path.basename(outPdfPath, ".pdf");
    const texPath = path.join(outDir, `${base}.tex`);
    const logPath = path.join(outDir, `${base}.log`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(texPath, tex);
    await exec(bin, [texPath, "--outdir", outDir, "--keep-logs"]);

    let pages: number | null = null;
    try {
      const log = fs.readFileSync(logPath, "utf8");
      pages = parsePageCount(log);
    } catch {
      pages = null;
    }
    if (pages === null) {
      console.warn(`makeTectonicCompiler: could not parse page count from ${logPath}; assuming 1 page`);
      pages = 1;
    }
    return { pdfPath: outPdfPath, pages };
  };
}
