import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { dataDir, resumesDir, resolveResumePath, toStoredResumePath } from "@/lib/paths";

// The rows compiled on the Mac on 2026-09-02 store exactly this; after the move to Windows the
// file lives under the Windows data dir with the same basename.
const MAC_PDF = "/Users/moka/Documents/job_seeker/data/resumes/swe_general_v1.pdf";
const WIN_DATA = "E:\\sortie\\data";

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-paths-"));
  fs.mkdirSync(path.join(dir, "resumes"), { recursive: true });
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("dataDir", () => {
  const saved = process.env.DATA_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = saved;
  });

  it("defaults to <cwd>/data and honours DATA_DIR", () => {
    delete process.env.DATA_DIR;
    expect(dataDir()).toBe(path.join(process.cwd(), "data"));
    expect(resumesDir()).toBe(path.join(process.cwd(), "data", "resumes"));
    process.env.DATA_DIR = WIN_DATA;
    expect(dataDir()).toBe(WIN_DATA);
    expect(resumesDir()).toBe(path.join(WIN_DATA, "resumes"));
  });
});

describe("resolveResumePath", () => {
  it("re-bases a Mac-era absolute path onto the Windows data dir by basename when the Mac file is gone", () => {
    const resolved = resolveResumePath(MAC_PDF, { dataDir: WIN_DATA, exists: () => false });
    expect(resolved).toBe(path.join(WIN_DATA, "resumes", "swe_general_v1.pdf"));
    expect(resolved).not.toContain("/Users/moka");
    if (process.platform === "win32") expect(resolved).toBe("E:\\sortie\\data\\resumes\\swe_general_v1.pdf");
  });

  it("does the same for a Windows-style path read elsewhere (basename split on backslashes too)", () => {
    const dir = scratch();
    expect(resolveResumePath("E:\\old-box\\data\\resumes\\mle_v1.pdf", { dataDir: dir, exists: () => false })).toBe(
      path.join(dir, "resumes", "mle_v1.pdf")
    );
  });

  it("joins a data-dir-relative path (the format generateResume stores now)", () => {
    expect(resolveResumePath("resumes/quant_v1.pdf", { dataDir: WIN_DATA })).toBe(path.join(WIN_DATA, "resumes", "quant_v1.pdf"));
  });

  it("returns an empty string for a missing value", () => {
    expect(resolveResumePath(null)).toBe("");
    expect(resolveResumePath(undefined)).toBe("");
    expect(resolveResumePath("")).toBe("");
  });

  it("uses the real filesystem by default: an absent foreign path falls back, a present local file stays put", () => {
    const dir = scratch();
    const local = path.join(dir, "resumes", "ai_infra_v1.pdf");
    fs.writeFileSync(local, "%PDF");
    expect(resolveResumePath("/Users/nobody/job_seeker/data/resumes/ai_infra_v1.pdf", { dataDir: dir })).toBe(local);
    // A file outside the data dir (custom outDir) is kept as long as it exists.
    expect(resolveResumePath(local, { dataDir: path.join(dir, "other") })).toBe(local);
  });
});

describe("toStoredResumePath", () => {
  it("stores a file inside the data dir relative to it, with forward slashes", () => {
    expect(toStoredResumePath(path.join(WIN_DATA, "resumes", "swe_general_v1.pdf"), WIN_DATA)).toBe("resumes/swe_general_v1.pdf");
  });

  it("keeps a file outside the data dir absolute", () => {
    const dir = scratch();
    const outside = path.join(dir, "elsewhere", "x.pdf");
    expect(toStoredResumePath(outside, path.join(dir, "data"))).toBe(outside);
    expect(toStoredResumePath(path.join(dir, "data"), path.join(dir, "data"))).toBe(path.join(dir, "data"));
    if (process.platform === "win32") expect(toStoredResumePath("C:\\tmp\\x.pdf", WIN_DATA)).toBe("C:\\tmp\\x.pdf");
  });

  it("round-trips through resolveResumePath", () => {
    const abs = path.join(WIN_DATA, "resumes", "robotics_v1.pdf");
    expect(resolveResumePath(toStoredResumePath(abs, WIN_DATA), { dataDir: WIN_DATA })).toBe(abs);
  });
});
