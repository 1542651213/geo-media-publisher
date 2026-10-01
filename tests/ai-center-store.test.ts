import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as database from "@publisher/db";
import { DEFAULT_PROMPT_TEMPLATES } from "@publisher/domain";

it("adds AI metadata without changing prior articles/jobs and retains template versions", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-center-store-"));
  const { db, repository } = database.openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages/db/migrations"));
  try {
    const factory = (database as unknown as { createAICenterStore: (inputRepository: typeof repository) => { templates(): typeof DEFAULT_PROMPT_TEMPLATES; saveTemplate(template: typeof DEFAULT_PROMPT_TEMPLATES[number]): void } }).createAICenterStore;
    expect(factory, "AI persistence store exists").toBeTypeOf("function");
    const store = factory(repository);
    expect(store.templates()).toHaveLength(12);
    store.saveTemplate({ ...DEFAULT_PROMPT_TEMPLATES[0]!, version: 2, name: "新版行业科普" });
    expect(store.templates().filter(item => item.templateId === "industry").map(item => item.version)).toEqual([1, 2]);
    expect(repository.listJobs()).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
