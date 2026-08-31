import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import { Compiler } from "@/resume/generate";

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

// tectonic compiles a .tex to a .pdf in an output dir. We write the tex to <outdir>/<name>.tex,
// run tectonic on it, and it emits <outdir>/<name>.pdf.
export function makeTectonicCompiler(opts: TectonicOptions = {}): Compiler {
  const bin = opts.bin ?? process.env.TECTONIC_BIN ?? "tectonic";
  const exec = opts.exec ?? defaultExec;
  return async (tex: string, outPdfPath: string): Promise<string> => {
    const outDir = path.dirname(outPdfPath);
    const base = path.basename(outPdfPath, ".pdf");
    const texPath = path.join(outDir, `${base}.tex`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(texPath, tex);
    await exec(bin, [texPath, "--outdir", outDir, "--keep-logs"]);
    return outPdfPath;
  };
}
