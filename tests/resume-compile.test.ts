import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { makeTectonicCompiler } from "@/resume/compile";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resume-compile-test-"));
}

describe("tectonic compiler wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  it("invokes tectonic with the tex file and returns the pdf path + page count", async () => {
    const dir = tmpDir();
    const calls: string[][] = [];
    const fakeExec = async (bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      fs.writeFileSync(path.join(dir, "out.log"), "blah blah\nOutput written on out.xdv (1 page, 1234 bytes).\n");
    };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    const out = await compile("\\documentclass{article}\\begin{document}x\\end{document}", path.join(dir, "out.pdf"));
    expect(out.pdfPath).toBe(path.join(dir, "out.pdf"));
    expect(out.pages).toBe(1);
    expect(calls[0][0]).toBe("tectonic");
    expect(calls[0].join(" ")).toMatch(/--outdir/);
    expect(calls[0].join(" ")).toMatch(/--keep-logs/);
  });

  it("parses a multi-page log", async () => {
    const dir = tmpDir();
    const fakeExec = async () => {
      fs.writeFileSync(path.join(dir, "out.log"), "Output written on out.xdv (2 pages, 4567 bytes).\n");
    };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    const out = await compile("tex", path.join(dir, "out.pdf"));
    expect(out.pages).toBe(2);
  });

  it("falls back to pages:1 with a warning if the log can't be parsed", async () => {
    const dir = tmpDir();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeExec = async () => {
      fs.writeFileSync(path.join(dir, "out.log"), "no page info here\n");
    };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    const out = await compile("tex", path.join(dir, "out.pdf"));
    expect(out.pages).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to pages:1 with a warning if the log file is missing entirely", async () => {
    const dir = tmpDir();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeExec = async () => {}; // no log written
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    const out = await compile("tex", path.join(dir, "out.pdf"));
    expect(out.pages).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("throws with tectonic stderr on failure", async () => {
    const fakeExec = async () => { throw new Error("tectonic: undefined control sequence"); };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    await expect(compile("bad", "/tmp/r/out.pdf")).rejects.toThrow(/tectonic/i);
  });
});
