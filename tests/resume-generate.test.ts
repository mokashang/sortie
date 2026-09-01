import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { createExperience } from "@/resume/experiences";
import { generateResume, isSafeVersionName } from "@/resume/generate";
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

// One-page fake compiler: never trims, always reports the doc fits on one page.
const onePageCompile = async (_tex: string, outPath: string) => ({ pdfPath: outPath, pages: 1 });
const noText = async () => null;

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
    const fakeCompile = async (tex: string, outPath: string) => { compiled.push({ tex, pdfPath: outPath }); return { pdfPath: outPath, pages: 1 }; };

    const res = await generateResume(db, {
      backend: fakeBackend(selection),
      contact,
      direction: "ai_infra",
      versionName: "ai_infra_v1",
      compile: fakeCompile,
      extractText: noText,
      outDir: "/tmp/resumes-test",
    });

    expect(res.resumeId).toBeGreaterThan(0);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].tex).toContain("Sharded training across 8 GPUs");
    expect(compiled[0].tex).not.toContain("React dashboard"); // not selected
    expect(res.pages).toBe(1);
    expect(res.trimmed).toBe(0);
    expect(res.warnings).toEqual([]);
    const row = db.prepare("SELECT version_name, directions, pdf_path FROM resumes WHERE id=?").get(res.resumeId) as any;
    expect(row.version_name).toBe("ai_infra_v1");
    expect(JSON.parse(row.directions)).toContain("ai_infra");
  });

  it("throws a clear error if the model selects an experience id that does not exist", async () => {
    const db = openDb(":memory:");
    seed(db);
    const selection = { sections: [{ heading: "Projects", entries: [{ id: 9999, bullets: ["ghost"] }] }] };
    await expect(
      generateResume(db, { backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "v", compile: onePageCompile, extractText: noText, outDir: "/tmp/x" })
    ).rejects.toThrow(/unknown experience id|9999/i);
  });

  it("resolves resumeId by version_name on regenerate, not by stale last_insert_rowid", async () => {
    // SQLite's last_insert_rowid() is not reset by ON CONFLICT DO UPDATE — it keeps the last
    // real INSERT's rowid on the connection. Regenerating an existing version_name must still
    // return the id of the ORIGINAL row (updated in place), not whatever id was last inserted.
    const db = openDb(":memory:");
    seed(db);
    const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
    const selection = { sections: [{ heading: "Education", entry_ids: [exps[0].id] }] };

    const first = await generateResume(db, {
      backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "dup_v1",
      compile: onePageCompile, extractText: noText, outDir: "/tmp/resumes-test",
    });

    // Advance last_insert_rowid on this connection past dup_v1's row by generating an unrelated
    // second version.
    await generateResume(db, {
      backend: fakeBackend(selection), contact, direction: "mle", versionName: "other_v2",
      compile: onePageCompile, extractText: noText, outDir: "/tmp/resumes-test",
    });

    // Regenerate dup_v1 with a different direction — this hits the ON CONFLICT DO UPDATE path.
    const regenerated = await generateResume(db, {
      backend: fakeBackend(selection), contact, direction: "swe_backend", versionName: "dup_v1",
      compile: onePageCompile, extractText: noText, outDir: "/tmp/resumes-test",
    });

    const row = db.prepare("SELECT id FROM resumes WHERE version_name=?").get("dup_v1") as { id: number };
    expect(regenerated.resumeId).toBe(first.resumeId);
    expect(regenerated.resumeId).toBe(row.id);

    const dupCount = (db.prepare("SELECT COUNT(*) n FROM resumes WHERE version_name=?").get("dup_v1") as { n: number }).n;
    expect(dupCount).toBe(1);
  });

  describe("one-page trim loop", () => {
    function seedTrimmable(db: ReturnType<typeof openDb>) {
      createExperience(db, { kind: "education", title: "M.S. ECE", organization: "USC", start_date: "2025", end_date: "2027", bullets: [], sort_order: 0 });
      createExperience(db, {
        kind: "work", title: "Entry A", organization: "Acme",
        bullets: [{ text: "a1", directions: [] }, { text: "a2", directions: [] }, { text: "a3", directions: [] }], sort_order: 0,
      });
      createExperience(db, {
        kind: "work", title: "Entry B", organization: "Acme",
        bullets: [{ text: "b1", directions: [] }, { text: "b2", directions: [] }, { text: "b3", directions: [] }], sort_order: 1,
      });
      createExperience(db, { kind: "project", title: "Entry C", organization: "X", bullets: [{ text: "c1", directions: [] }], sort_order: 0 });
      createExperience(db, { kind: "project", title: "Entry D", organization: "X", bullets: [{ text: "d1", directions: [] }], sort_order: 1 });
    }

    function trimmableSelection(exps: { id: number }[]) {
      return {
        sections: [
          { heading: "Education", entry_ids: [exps[0].id] },
          { heading: "Experience", entries: [
            { id: exps[1].id, bullets: ["a1", "a2", "a3"] },
            { id: exps[2].id, bullets: ["b1", "b2", "b3"] },
          ] },
          { heading: "Projects", entries: [
            { id: exps[3].id, bullets: ["c1"] },
            { id: exps[4].id, bullets: ["d1"] },
          ] },
        ],
      };
    }

    it("trims deterministically (most-bulleted entry first, then whole entries) until it converges", async () => {
      const db = openDb(":memory:");
      seedTrimmable(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = trimmableSelection(exps);

      let callCount = 0;
      const texByCall: string[] = [];
      const fakeCompile = async (tex: string, outPath: string) => {
        callCount++;
        texByCall.push(tex);
        return { pdfPath: outPath, pages: callCount <= 3 ? 2 : 1 };
      };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_v1",
        compile: fakeCompile, extractText: noText, outDir: "/tmp/resumes-test",
      });

      expect(callCount).toBe(4); // initial compile + 3 trim/recompile cycles
      expect(res.pages).toBe(1);
      expect(res.trimmed).toBe(3);
      // Step 1 drops a3 (first entry hitting the max of 3 bullets).
      expect(texByCall[1]).not.toContain("a3");
      expect(texByCall[1]).toContain("b3");
      // Step 2 drops b3 (now the max).
      expect(texByCall[2]).not.toContain("b3");
      // Step 3 drops a2 (A and B tied at 2; A found first).
      expect(texByCall[3]).not.toContain("a2");
      expect(texByCall[3]).toContain("b2");
    });

    it("prioritizes the entry with the most bullet TEXT (chars), not just the most bullet items", async () => {
      // Experience has 3 short one-line bullets (few chars each); Projects has a single entry
      // with 2 bullets but one of them is a long, dense sentence — more total characters than
      // all of Experience's bullets combined. The long-bullet entry should be trimmed first,
      // even though it has fewer bullet *items* than the short-bulleted Experience entry.
      const db = openDb(":memory:");
      createExperience(db, { kind: "education", title: "M.S. ECE", organization: "USC", start_date: "2025", end_date: "2027", bullets: [], sort_order: 0 });
      createExperience(db, {
        kind: "work", title: "Short Bullets Co", organization: "Acme",
        bullets: [{ text: "did x", directions: [] }, { text: "did y", directions: [] }, { text: "did z", directions: [] }], sort_order: 0,
      });
      createExperience(db, {
        kind: "project", title: "Long Bullet Project", organization: "X",
        bullets: [
          { text: "short one", directions: [] },
          { text: "This is a very long and dense project bullet describing substantial technical work across many systems and components in great detail", directions: [] },
        ],
        sort_order: 0,
      });
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = {
        sections: [
          { heading: "Education", entry_ids: [exps[0].id] },
          { heading: "Experience", entries: [{ id: exps[1].id, bullets: ["did x", "did y", "did z"] }] },
          { heading: "Projects", entries: [{ id: exps[2].id, bullets: ["short one", "This is a very long and dense project bullet describing substantial technical work across many systems and components in great detail"] }] },
        ],
      };

      let calls = 0;
      const texByCall: string[] = [];
      const fakeCompile = async (tex: string, outPath: string) => {
        calls++;
        texByCall.push(tex);
        return { pdfPath: outPath, pages: calls === 1 ? 2 : 1 };
      };

      await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_chars_v1",
        compile: fakeCompile, extractText: noText, outDir: "/tmp/resumes-test",
      });

      // The long project bullet should be dropped first, even though the Experience entry has
      // more bullet items (3 vs 2).
      expect(texByCall[1]).not.toContain("very long and dense project bullet");
      expect(texByCall[1]).toContain("did x");
      expect(texByCall[1]).toContain("did y");
      expect(texByCall[1]).toContain("did z");
    });

    it("stops after the trim attempt cap if pages never converge to 1", async () => {
      // seedTrimmable only has 5 non-education entries' worth of content (max 4 whole-entry
      // drops beyond the bullet-level trims), so it bottoms out (trimOneStep returns null)
      // before hitting the cap. Assert it stops (doesn't loop forever) and reports pages>1.
      const db = openDb(":memory:");
      seedTrimmable(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = trimmableSelection(exps);

      let callCount = 0;
      const fakeCompile = async (_tex: string, outPath: string) => { callCount++; return { pdfPath: outPath, pages: 2 }; };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_v2",
        compile: fakeCompile, extractText: noText, outDir: "/tmp/resumes-test",
      });

      expect(res.pages).toBe(2);
      expect(res.warnings.some((w) => /2 pages/.test(w))).toBe(true);
      expect(callCount).toBeLessThan(30); // terminates well within the attempt cap, doesn't loop forever
    });

    it("never exceeds the trim attempt cap even with unlimited content to trim", async () => {
      const db = openDb(":memory:");
      createExperience(db, { kind: "education", title: "M.S. ECE", organization: "USC", start_date: "2025", end_date: "2027", bullets: [], sort_order: 0 });
      // 10 experience entries with 3 bullets each — far more content than any realistic
      // one-pager, guaranteeing trimOneStep never runs dry within the cap.
      const entryIds: number[] = [];
      for (let i = 0; i < 10; i++) {
        entryIds.push(
          createExperience(db, {
            kind: "work", title: `Entry ${i}`, organization: "Acme",
            bullets: [{ text: `${i}-a`, directions: [] }, { text: `${i}-b`, directions: [] }, { text: `${i}-c`, directions: [] }],
            sort_order: i,
          })
        );
      }
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = {
        sections: [
          { heading: "Education", entry_ids: [exps[0].id] },
          { heading: "Experience", entries: exps.slice(1).map((e) => ({ id: e.id, bullets: ["a", "b", "c"] })) },
        ],
      };
      let callCount = 0;
      const fakeCompile = async (_tex: string, outPath: string) => { callCount++; return { pdfPath: outPath, pages: 2 }; };
      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_v3",
        compile: fakeCompile, extractText: noText, outDir: "/tmp/resumes-test",
      });
      expect(res.pages).toBe(2);
      expect(callCount).toBe(21); // initial + exactly MAX_TRIM_ATTEMPTS (20)
      expect(res.trimmed).toBe(20);
    });
  });

  describe("content self-check", () => {
    it("surfaces a warning when the extracted PDF text is missing the candidate's name", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = { sections: [{ heading: "Education", entry_ids: [exps[0].id] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v1",
        compile: onePageCompile, extractText: async () => "Someone Else\nEducation\nM.S. ECE", outDir: "/tmp/resumes-test",
      });
      expect(res.warnings.some((w) => /name/i.test(w))).toBe(true);
    });

    it("surfaces a warning when raw LaTeX commands leak into the extracted text", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = { sections: [{ heading: "Education", entry_ids: [exps[0].id] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v2",
        compile: onePageCompile, extractText: async () => "M S\n\\resumeItem{broken}", outDir: "/tmp/resumes-test",
      });
      expect(res.warnings.some((w) => /latex|leak/i.test(w))).toBe(true);
    });

    it("surfaces a warning when extracted text looks empty", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = { sections: [{ heading: "Education", entry_ids: [exps[0].id] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v3",
        compile: onePageCompile, extractText: async () => "  ", outDir: "/tmp/resumes-test",
      });
      expect(res.warnings.some((w) => /empty/i.test(w))).toBe(true);
    });

    it("produces no warnings for clean one-page content", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = { sections: [{ heading: "Education", entry_ids: [exps[0].id] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v4",
        compile: onePageCompile, extractText: async () => "M S\nEducation\nM.S. ECE University of Southern California, Los Angeles, CA 2025-2027", outDir: "/tmp/resumes-test",
      });
      expect(res.warnings).toEqual([]);
    });

    it("skips content checks (no warnings, no crash) when text extraction returns null", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = { sections: [{ heading: "Education", entry_ids: [exps[0].id] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v5",
        compile: onePageCompile, extractText: noText, outDir: "/tmp/resumes-test",
      });
      expect(res.warnings).toEqual([]);
    });
  });
});

describe("isSafeVersionName", () => {
  it("rejects names that could escape the output directory", () => {
    expect(isSafeVersionName("../x")).toBe(false);
    expect(isSafeVersionName("a/b")).toBe(false);
    expect(isSafeVersionName("a\\b")).toBe(false);
  });
  it("accepts plain version names", () => {
    expect(isSafeVersionName("ai_infra_v1")).toBe(true);
    expect(isSafeVersionName("swe_backend_2027")).toBe(true);
  });
});
