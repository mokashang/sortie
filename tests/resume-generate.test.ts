import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { createExperience } from "@/resume/experiences";
import { generateResume } from "@/resume/generate";
import { LlmBackend } from "@/llm/types";

function seed(db: ReturnType<typeof openDb>) {
  createExperience(db, { kind: "education", title: "M.S. ECE", organization: "USC", start_date: "2025", end_date: "2027", bullets: [], sort_order: 0 });
  createExperience(db, { kind: "project", title: "Distributed Trainer", organization: "USC", bullets: [{ text: "Sharded training across 8 GPUs", directions: ["ai_infra"] }, { text: "Wrote a React dashboard", directions: ["swe_general"] }], sort_order: 0 });
}

const contact = { name: "M S", email: "m@x.com", phone: "+1", linkedin: "in/x", github: "gh/x" };

// Fake backend returns a selection: keep the education entry and the ai_infra bullet only.
const fakeBackend = (selection: object): LlmBackend => ({
  name: "fake",
  complete: async () => ({ text: JSON.stringify(selection), backend: "fake" }),
});

describe("generateResume", () => {
  it("builds a ResumeDoc from the model's selection, compiles, and records a resume version", async () => {
    const db = openDb(":memory:");
    seed(db);
    const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
    const selection = {
      sections: [
        { heading: "Education", entry_ids: [exps[0].id] },
        { heading: "Projects", entries: [{ id: exps[1].id, bullets: ["Sharded training across 8 GPUs"] }] },
      ],
    };
    const compiled: { tex: string; pdfPath: string }[] = [];
    const fakeCompile = async (tex: string, outPath: string) => { compiled.push({ tex, pdfPath: outPath }); return outPath; };

    const res = await generateResume(db, {
      backend: fakeBackend(selection),
      contact,
      direction: "ai_infra",
      versionName: "ai_infra_v1",
      compile: fakeCompile,
      outDir: "/tmp/resumes-test",
    });

    expect(res.resumeId).toBeGreaterThan(0);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].tex).toContain("Sharded training across 8 GPUs");
    expect(compiled[0].tex).not.toContain("React dashboard"); // not selected
    const row = db.prepare("SELECT version_name, directions, pdf_path FROM resumes WHERE id=?").get(res.resumeId) as any;
    expect(row.version_name).toBe("ai_infra_v1");
    expect(JSON.parse(row.directions)).toContain("ai_infra");
  });

  it("throws a clear error if the model selects an experience id that does not exist", async () => {
    const db = openDb(":memory:");
    seed(db);
    const selection = { sections: [{ heading: "Projects", entries: [{ id: 9999, bullets: ["ghost"] }] }] };
    await expect(
      generateResume(db, { backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "v", compile: async (_t, o) => o, outDir: "/tmp/x" })
    ).rejects.toThrow(/unknown experience id|9999/i);
  });
});
