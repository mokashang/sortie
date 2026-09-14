import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { createExperience, listExperiences, updateExperience, deleteExperience, ExperienceInput } from "@/resume/experiences";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

const sample: ExperienceInput = {
  kind: "work",
  title: "SWE Intern",
  organization: "Acme",
  location: "SF",
  start_date: "2025-06",
  end_date: "2025-08",
  bullets: [{ text: "Built a service", directions: ["swe_backend"] }],
  sort_order: 0,
};

describe("experiences repo", () => {
  it("creates and lists", () => {
    const db = openDb(":memory:");
    const id = createExperience(db, U, sample);
    const all = listExperiences(db, U);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].bullets[0].text).toBe("Built a service");
  });
  it("validates kind and bullet shape", () => {
    const db = openDb(":memory:");
    expect(() => createExperience(db, U, { ...sample, kind: "nonsense" as any })).toThrow();
    expect(() => createExperience(db, U, { ...sample, bullets: [{ text: "", directions: ["swe_backend"] }] })).toThrow();
  });
  it("updates and deletes", () => {
    const db = openDb(":memory:");
    const id = createExperience(db, U, sample);
    updateExperience(db, U, id, { ...sample, title: "Senior SWE Intern" });
    expect(listExperiences(db, U)[0].title).toBe("Senior SWE Intern");
    deleteExperience(db, U, id);
    expect(listExperiences(db, U)).toHaveLength(0);
  });
  it("lists ordered by kind then sort_order", () => {
    const db = openDb(":memory:");
    createExperience(db, U, { ...sample, kind: "project", title: "P2", sort_order: 2 });
    createExperience(db, U, { ...sample, kind: "project", title: "P1", sort_order: 1 });
    const projects = listExperiences(db, U).filter((e) => e.kind === "project");
    expect(projects.map((p) => p.title)).toEqual(["P1", "P2"]);
  });
});
