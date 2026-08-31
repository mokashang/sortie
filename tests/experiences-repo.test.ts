import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { createExperience, listExperiences, updateExperience, deleteExperience, ExperienceInput } from "@/resume/experiences";

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
    const id = createExperience(db, sample);
    const all = listExperiences(db);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].bullets[0].text).toBe("Built a service");
  });
  it("validates kind and bullet shape", () => {
    const db = openDb(":memory:");
    expect(() => createExperience(db, { ...sample, kind: "nonsense" as any })).toThrow();
    expect(() => createExperience(db, { ...sample, bullets: [{ text: "", directions: ["swe_backend"] }] })).toThrow();
  });
  it("updates and deletes", () => {
    const db = openDb(":memory:");
    const id = createExperience(db, sample);
    updateExperience(db, id, { ...sample, title: "Senior SWE Intern" });
    expect(listExperiences(db)[0].title).toBe("Senior SWE Intern");
    deleteExperience(db, id);
    expect(listExperiences(db)).toHaveLength(0);
  });
  it("lists ordered by kind then sort_order", () => {
    const db = openDb(":memory:");
    createExperience(db, { ...sample, kind: "project", title: "P2", sort_order: 2 });
    createExperience(db, { ...sample, kind: "project", title: "P1", sort_order: 1 });
    const projects = listExperiences(db).filter((e) => e.kind === "project");
    expect(projects.map((p) => p.title)).toEqual(["P1", "P2"]);
  });
});
