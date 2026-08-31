import { describe, it, expect } from "vitest";
import { makeTectonicCompiler } from "@/resume/compile";

describe("tectonic compiler wrapper", () => {
  it("invokes tectonic with the tex file and returns the pdf path", async () => {
    const calls: string[][] = [];
    const fakeExec = async (bin: string, args: string[]) => { calls.push([bin, ...args]); };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    const out = await compile("\\documentclass{article}\\begin{document}x\\end{document}", "/tmp/r/out.pdf");
    expect(out).toBe("/tmp/r/out.pdf");
    expect(calls[0][0]).toBe("tectonic");
    expect(calls[0].join(" ")).toMatch(/--outdir/);
  });
  it("throws with tectonic stderr on failure", async () => {
    const fakeExec = async () => { throw new Error("tectonic: undefined control sequence"); };
    const compile = makeTectonicCompiler({ bin: "tectonic", exec: fakeExec });
    await expect(compile("bad", "/tmp/r/out.pdf")).rejects.toThrow(/tectonic/i);
  });
});
