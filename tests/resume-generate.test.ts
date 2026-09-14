import { describe, it, expect } from "vitest";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";
import { createExperience } from "@/resume/experiences";
import { generateResume, isSafeVersionName } from "@/resume/generate";
import { LlmBackend } from "@/llm/types";
import { resolveResumePath } from "@/lib/paths";

// Scratch output dirs under os.tmpdir() rather than a literal /tmp, which on Windows would resolve to
// <current drive>:	mp (not creatable when the repo lives on a drive whose root is read-only).
const TMP_OUT = path.join(os.tmpdir(), "sortie-resumes-test");
const TMP_X = path.join(os.tmpdir(), "sortie-resumes-x");

// Seed with one entry of each kind that matters for section-structure tests: education, work,
// project, skill. Kept deliberately distinct per kind so tests can assert deterministic section
// separation (Experience vs Projects) rather than relying on LLM-chosen headings.
function seed(db: ReturnType<typeof openDb>) {
  createExperience(db, { kind: "education", title: "M.S. ECE", organization: "USC", start_date: "2025", end_date: "2027", bullets: [], sort_order: 0 });
  createExperience(db, { kind: "work", title: "SWE Intern", organization: "Acme", bullets: [{ text: "Shipped a backend service", directions: ["swe_backend"] }], sort_order: 0 });
  createExperience(db, { kind: "project", title: "Distributed Trainer", organization: "USC", bullets: [{ text: "Sharded training across 8 GPUs", directions: ["ai_infra"] }, { text: "Wrote a React dashboard", directions: ["swe_general"] }], sort_order: 0 });
  createExperience(db, { kind: "skill", title: "Languages", organization: null, bullets: [{ text: "C++, Python", directions: [] }], sort_order: 0 });
}

const contact = { name: "M S", email: "m@x.com", phone: "+1", linkedin: "in/x", github: "gh/x" };

// Fake backend returns a selection: { include: [...] }.
const fakeBackend = (selection: object): LlmBackend => ({
  name: "fake",
  complete: async () => ({ text: JSON.stringify(selection), backend: "fake" }),
});

// One-page fake compiler: never trims, always reports the doc fits on one page.
const onePageCompile = async (_tex: string, outPath: string) => ({ pdfPath: outPath, pages: 1, overfullCount: 0, worstOverfullPt: 0 });
const noText = async () => null;

describe("generateResume", () => {
  it("builds a ResumeDoc from the model's { include } selection, compiles, and records a resume version", async () => {
    const db = openDb(":memory:");
    seed(db);
    const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
    const eduId = exps.find((e) => e.kind === "education")!.id;
    const workId = exps.find((e) => e.kind === "work")!.id;
    const projId = exps.find((e) => e.kind === "project")!.id;
    const selection = {
      include: [
        { id: eduId, bullets: [] },
        { id: workId, bullets: ["Shipped a backend service"] },
        { id: projId, bullets: ["Sharded training across 8 GPUs"] },
      ],
    };
    const compiled: { tex: string; pdfPath: string }[] = [];
    const fakeCompile = async (tex: string, outPath: string) => { compiled.push({ tex, pdfPath: outPath }); return { pdfPath: outPath, pages: 1, overfullCount: 0, worstOverfullPt: 0 }; };

    const res = await generateResume(db, {
      backend: fakeBackend(selection),
      contact,
      direction: "ai_infra",
      versionName: "ai_infra_v1",
      compile: fakeCompile,
      extractText: noText,
      outDir: TMP_OUT,
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
    const selection = { include: [{ id: 9999, bullets: ["ghost"] }] };
    await expect(
      generateResume(db, { backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "v", compile: onePageCompile, extractText: noText, outDir: TMP_X })
    ).rejects.toThrow(/unknown experience id|9999/i);
  });

  it("rejects an empty-string bullet (each chosen bullet must be non-empty)", async () => {
    const db = openDb(":memory:");
    seed(db);
    const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
    const workId = exps.find((e) => e.kind === "work")!.id;
    const selection = { include: [{ id: workId, bullets: ["", "Shipped a backend service"] }] };
    await expect(
      generateResume(db, { backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "v", compile: onePageCompile, extractText: noText, outDir: TMP_X })
    ).rejects.toThrow();
  });

  it("resolves resumeId by version_name on regenerate, not by stale last_insert_rowid", async () => {
    // SQLite's last_insert_rowid() is not reset by ON CONFLICT DO UPDATE — it keeps the last
    // real INSERT's rowid on the connection. Regenerating an existing version_name must still
    // return the id of the ORIGINAL row (updated in place), not whatever id was last inserted.
    const db = openDb(":memory:");
    seed(db);
    const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
    const eduId = exps.find((e) => e.kind === "education")!.id;
    const selection = { include: [{ id: eduId, bullets: [] }] };

    const first = await generateResume(db, {
      backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "dup_v1",
      compile: onePageCompile, extractText: noText, outDir: TMP_OUT,
    });

    // Advance last_insert_rowid on this connection past dup_v1's row by generating an unrelated
    // second version.
    await generateResume(db, {
      backend: fakeBackend(selection), contact, direction: "mle", versionName: "other_v2",
      compile: onePageCompile, extractText: noText, outDir: TMP_OUT,
    });

    // Regenerate dup_v1 with a different direction — this hits the ON CONFLICT DO UPDATE path.
    const regenerated = await generateResume(db, {
      backend: fakeBackend(selection), contact, direction: "swe_backend", versionName: "dup_v1",
      compile: onePageCompile, extractText: noText, outDir: TMP_OUT,
    });

    const row = db.prepare("SELECT id FROM resumes WHERE version_name=?").get("dup_v1") as { id: number };
    expect(regenerated.resumeId).toBe(first.resumeId);
    expect(regenerated.resumeId).toBe(row.id);

    const dupCount = (db.prepare("SELECT COUNT(*) n FROM resumes WHERE version_name=?").get("dup_v1") as { n: number }).n;
    expect(dupCount).toBe(1);
  });

  describe("deterministic section structure (by experience kind)", () => {
    it("builds distinct Education / Experience / Projects / Technical Skills sections, in that fixed order, from a single flat include list", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
      const eduId = exps.find((e) => e.kind === "education")!.id;
      const workId = exps.find((e) => e.kind === "work")!.id;
      const projId = exps.find((e) => e.kind === "project")!.id;
      const skillId = exps.find((e) => e.kind === "skill")!.id;
      // Deliberately out-of-kind-order in `include` — the app must still group by kind into the
      // fixed section order, not follow the include array's raw order across kinds.
      const selection = {
        include: [
          { id: projId, bullets: ["Sharded training across 8 GPUs"] },
          { id: skillId, bullets: ["C++, Python"] },
          { id: eduId, bullets: [] },
          { id: workId, bullets: ["Shipped a backend service"] },
        ],
      };
      const compiled: { tex: string }[] = [];
      const fakeCompile = async (tex: string, outPath: string) => { compiled.push({ tex }); return { pdfPath: outPath, pages: 1, overfullCount: 0, worstOverfullPt: 0 }; };

      await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "struct_v1",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
      });

      const tex = compiled[0].tex;
      const iEdu = tex.indexOf("\\section{Education}");
      const iExp = tex.indexOf("\\section{Experience}");
      const iProj = tex.indexOf("\\section{Projects}");
      const iSkill = tex.indexOf("\\section{Technical Skills}");
      expect(iEdu).toBeGreaterThan(-1);
      expect(iExp).toBeGreaterThan(-1);
      expect(iProj).toBeGreaterThan(-1);
      expect(iSkill).toBeGreaterThan(-1);
      // Fixed order regardless of include order: Education, Experience, Projects, Technical Skills.
      expect(iEdu).toBeLessThan(iExp);
      expect(iExp).toBeLessThan(iProj);
      expect(iProj).toBeLessThan(iSkill);

      // Content lands in the section matching its kind, not merged together.
      const expSection = tex.slice(iExp, iProj);
      const projSection = tex.slice(iProj, iSkill);
      expect(expSection).toContain("Shipped a backend service");
      expect(expSection).not.toContain("Sharded training across 8 GPUs");
      expect(projSection).toContain("Sharded training across 8 GPUs");
      expect(projSection).not.toContain("Shipped a backend service");
    });

    it("omits a section entirely when zero experiences of that kind are included", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
      const eduId = exps.find((e) => e.kind === "education")!.id;
      const workId = exps.find((e) => e.kind === "work")!.id;
      // No project, no skill included.
      const selection = { include: [{ id: eduId, bullets: [] }, { id: workId, bullets: ["Shipped a backend service"] }] };
      const compiled: { tex: string }[] = [];
      const fakeCompile = async (tex: string, outPath: string) => { compiled.push({ tex }); return { pdfPath: outPath, pages: 1, overfullCount: 0, worstOverfullPt: 0 }; };

      await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "struct_v2",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
      });

      const tex = compiled[0].tex;
      expect(tex).toContain("\\section{Experience}");
      expect(tex).not.toContain("\\section{Projects}");
      expect(tex).not.toContain("\\section{Technical Skills}");
    });

    it("orders entries within a kind by their position in the model's `include` array, not by DB sort_order", async () => {
      const db = openDb(":memory:");
      createExperience(db, { kind: "work", title: "Entry A", organization: "Acme", bullets: [{ text: "a1", directions: [] }], sort_order: 0 });
      createExperience(db, { kind: "work", title: "Entry B", organization: "Acme", bullets: [{ text: "b1", directions: [] }], sort_order: 1 });
      const exps = db.prepare("SELECT id, title FROM experiences ORDER BY id").all() as { id: number; title: string }[];
      const idA = exps.find((e) => e.title === "Entry A")!.id;
      const idB = exps.find((e) => e.title === "Entry B")!.id;
      // Reverse of DB sort_order: B listed before A in `include`.
      const selection = { include: [{ id: idB, bullets: ["b1"] }, { id: idA, bullets: ["a1"] }] };
      const compiled: { tex: string }[] = [];
      const fakeCompile = async (tex: string, outPath: string) => { compiled.push({ tex }); return { pdfPath: outPath, pages: 1, overfullCount: 0, worstOverfullPt: 0 }; };

      await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "struct_v3",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
      });

      const tex = compiled[0].tex;
      expect(tex.indexOf("Entry B")).toBeLessThan(tex.indexOf("Entry A"));
    });
  });

  describe("prompt content (direction angling + honesty constraint)", () => {
    it("instructs the model to angle real experiences toward the target direction and never fabricate", async () => {
      const db = openDb(":memory:");
      seed(db);
      let captured = "";
      const capturingBackend: LlmBackend = {
        name: "capture",
        complete: async (req) => {
          captured = `${req.system}\n${req.prompt}`;
          return { text: JSON.stringify({ include: [] }), backend: "capture" };
        },
      };
      await generateResume(db, {
        backend: capturingBackend, contact, direction: "gpu_cuda", versionName: "prompt_v1",
        compile: onePageCompile, extractText: noText, outDir: TMP_OUT,
      });

      // Angling instruction present, bound to the target direction's label.
      expect(captured).toMatch(/angl|emphasi[sz]e|prioriti[sz]e/i);
      expect(captured).toContain("GPU / CUDA");
      // Hard never-fabricate constraint present.
      expect(captured).toMatch(/never (invent|fabricate)|do not (invent|fabricate)/i);
      expect(captured).toMatch(/strongest adjacent real work|adjacent real work/i);
      // New selection schema shape documented in the prompt, not the old free-form `sections`.
      expect(captured).toContain("\"include\"");
      expect(captured).not.toMatch(/"heading":\s*"Education"/);
    });
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
        include: [
          { id: exps[0].id, bullets: [] },
          { id: exps[1].id, bullets: ["a1", "a2", "a3"] },
          { id: exps[2].id, bullets: ["b1", "b2", "b3"] },
          { id: exps[3].id, bullets: ["c1"] },
          { id: exps[4].id, bullets: ["d1"] },
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
        return { pdfPath: outPath, pages: callCount <= 3 ? 2 : 1, overfullCount: 0, worstOverfullPt: 0 };
      };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_v1",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
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
        include: [
          { id: exps[0].id, bullets: [] },
          { id: exps[1].id, bullets: ["did x", "did y", "did z"] },
          { id: exps[2].id, bullets: ["short one", "This is a very long and dense project bullet describing substantial technical work across many systems and components in great detail"] },
        ],
      };

      let calls = 0;
      const texByCall: string[] = [];
      const fakeCompile = async (tex: string, outPath: string) => {
        calls++;
        texByCall.push(tex);
        return { pdfPath: outPath, pages: calls === 1 ? 2 : 1, overfullCount: 0, worstOverfullPt: 0 };
      };

      await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_chars_v1",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
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
      const fakeCompile = async (_tex: string, outPath: string) => { callCount++; return { pdfPath: outPath, pages: 2, overfullCount: 0, worstOverfullPt: 0 }; };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_v2",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
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
        include: [
          { id: exps[0].id, bullets: [] },
          ...exps.slice(1).map((e) => ({ id: e.id, bullets: ["a", "b", "c"] })),
        ],
      };
      let callCount = 0;
      const fakeCompile = async (_tex: string, outPath: string) => { callCount++; return { pdfPath: outPath, pages: 2, overfullCount: 0, worstOverfullPt: 0 }; };
      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "trim_v3",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
      });
      expect(res.pages).toBe(2);
      expect(callCount).toBe(21); // initial + exactly MAX_TRIM_ATTEMPTS (20)
      expect(res.trimmed).toBe(20);
    });
  });

  describe("overfull hbox detection (safety net)", () => {
    function seedOverfullable(db: ReturnType<typeof openDb>) {
      createExperience(db, { kind: "education", title: "M.S. ECE", organization: "USC", start_date: "2025", end_date: "2027", bullets: [], sort_order: 0 });
      createExperience(db, {
        kind: "work", title: "Entry A", organization: "Acme",
        bullets: [{ text: "a1", directions: [] }, { text: "a2", directions: [] }], sort_order: 0,
      });
    }

    it("treats a meaningful overfull hbox (>2pt) as a defect and trims/recompiles even though pages stays at 1", async () => {
      const db = openDb(":memory:");
      seedOverfullable(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = {
        include: [
          { id: exps[0].id, bullets: [] },
          { id: exps[1].id, bullets: ["a1", "a2"] },
        ],
      };

      let callCount = 0;
      const fakeCompile = async (_tex: string, outPath: string) => {
        callCount++;
        // First compile: fits on 1 page but has a meaningful overfull hbox (a long unwrapped
        // title running off the page). Second compile (after one trim): clean.
        return callCount === 1
          ? { pdfPath: outPath, pages: 1, overfullCount: 1, worstOverfullPt: 50 }
          : { pdfPath: outPath, pages: 1, overfullCount: 0, worstOverfullPt: 0 };
      };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "overfull_v1",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
      });

      expect(callCount).toBe(2); // initial compile + one trim/recompile cycle
      expect(res.trimmed).toBe(1);
      expect(res.pages).toBe(1);
      expect(res.overfullCount).toBe(0);
      expect(res.warnings).toEqual([]);
    });

    it("does not trigger a trim iteration for a trivial sub-2pt overfull hbox", async () => {
      const db = openDb(":memory:");
      seedOverfullable(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = {
        include: [
          { id: exps[0].id, bullets: [] },
          { id: exps[1].id, bullets: ["a1", "a2"] },
        ],
      };

      let callCount = 0;
      const fakeCompile = async (_tex: string, outPath: string) => {
        callCount++;
        return { pdfPath: outPath, pages: 1, overfullCount: 1, worstOverfullPt: 1.5 };
      };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "overfull_v2",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
      });

      expect(callCount).toBe(1); // no trim triggered — trivial overfull is not a defect
      expect(res.trimmed).toBe(0);
      expect(res.overfullCount).toBe(1);
      expect(res.warnings.some((w) => /overfull/i.test(w))).toBe(true);
    });

    it("surfaces a warning naming the remaining overfull count/severity if it never fully clears within the trim budget", async () => {
      const db = openDb(":memory:");
      seedOverfullable(db);
      const exps = db.prepare("SELECT id FROM experiences ORDER BY id").all() as { id: number }[];
      const selection = {
        include: [
          { id: exps[0].id, bullets: [] },
          { id: exps[1].id, bullets: ["a1", "a2"] },
        ],
      };
      let callCount = 0;
      const fakeCompile = async (_tex: string, outPath: string) => {
        callCount++;
        return { pdfPath: outPath, pages: 1, overfullCount: 2, worstOverfullPt: 40 };
      };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "swe_general", versionName: "overfull_v3",
        compile: fakeCompile, extractText: noText, outDir: TMP_OUT,
      });

      expect(res.overfullCount).toBe(2);
      expect(res.warnings.some((w) => /overfull/i.test(w) && /2/.test(w))).toBe(true);
      expect(callCount).toBeLessThan(30); // still terminates within the attempt cap
    });
  });

  describe("content self-check", () => {
    it("surfaces a warning when the extracted PDF text is missing the candidate's name", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
      const eduId = exps.find((e) => e.kind === "education")!.id;
      const selection = { include: [{ id: eduId, bullets: [] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v1",
        compile: onePageCompile, extractText: async () => "Someone Else\nEducation\nM.S. ECE", outDir: TMP_OUT,
      });
      expect(res.warnings.some((w) => /name/i.test(w))).toBe(true);
    });

    it("surfaces a warning when raw LaTeX commands leak into the extracted text", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
      const eduId = exps.find((e) => e.kind === "education")!.id;
      const selection = { include: [{ id: eduId, bullets: [] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v2",
        compile: onePageCompile, extractText: async () => "M S\n\\resumeItem{broken}", outDir: TMP_OUT,
      });
      expect(res.warnings.some((w) => /latex|leak/i.test(w))).toBe(true);
    });

    it("surfaces a warning when extracted text looks empty", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
      const eduId = exps.find((e) => e.kind === "education")!.id;
      const selection = { include: [{ id: eduId, bullets: [] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v3",
        compile: onePageCompile, extractText: async () => "  ", outDir: TMP_OUT,
      });
      expect(res.warnings.some((w) => /empty/i.test(w))).toBe(true);
    });

    it("produces no warnings for clean one-page content", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
      const eduId = exps.find((e) => e.kind === "education")!.id;
      const selection = { include: [{ id: eduId, bullets: [] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v4",
        compile: onePageCompile, extractText: async () => "M S\nEducation\nM.S. ECE University of Southern California, Los Angeles, CA 2025-2027", outDir: TMP_OUT,
      });
      expect(res.warnings).toEqual([]);
    });

    it("skips content checks (no warnings, no crash) when text extraction returns null", async () => {
      const db = openDb(":memory:");
      seed(db);
      const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
      const eduId = exps.find((e) => e.kind === "education")!.id;
      const selection = { include: [{ id: eduId, bullets: [] }] };

      const res = await generateResume(db, {
        backend: fakeBackend(selection), contact, direction: "ai_infra", versionName: "content_v5",
        compile: onePageCompile, extractText: noText, outDir: TMP_OUT,
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

describe("generateResume stored paths", () => {
  it("stores tex_path/pdf_path relative to the data dir when outDir lies inside it, absolute otherwise", async () => {
    const db = openDb(":memory:");
    seed(db);
    const exps = db.prepare("SELECT id, kind FROM experiences ORDER BY id").all() as { id: number; kind: string }[];
    const selection = { include: [{ id: exps.find((e) => e.kind === "work")!.id, bullets: ["Shipped a backend service"] }] };
    const dataRoot = path.join(os.tmpdir(), "sortie-resumes-data");
    const common = { backend: fakeBackend(selection), contact, direction: "ai_infra", compile: onePageCompile, extractText: noText, dataDir: dataRoot };

    const inside = await generateResume(db, { ...common, versionName: "inside_v1", outDir: path.join(dataRoot, "resumes") });
    const outside = await generateResume(db, { ...common, versionName: "outside_v1", outDir: TMP_OUT });

    const stored = (id: number) => db.prepare("SELECT tex_path, pdf_path FROM resumes WHERE id=?").get(id) as { tex_path: string; pdf_path: string };
    expect(stored(inside.resumeId)).toEqual({ tex_path: "resumes/inside_v1.tex", pdf_path: "resumes/inside_v1.pdf" });
    expect(stored(outside.resumeId)).toEqual({ tex_path: path.join(TMP_OUT, "outside_v1.tex"), pdf_path: path.join(TMP_OUT, "outside_v1.pdf") });
    // The result itself still hands the caller absolute paths, and a reader gets the same file back.
    expect(inside.pdfPath).toBe(path.join(dataRoot, "resumes", "inside_v1.pdf"));
    expect(resolveResumePath(stored(inside.resumeId).pdf_path, { dataDir: dataRoot })).toBe(inside.pdfPath);
  });
});
