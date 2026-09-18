import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { openDatabase } from "@publisher/db";

it("scoped live account registration preserves an explicit local id without forging login or authorization", () => {
  const directory = mkdtempSync(join(tmpdir(), "max3-account-"));
  const { db, repository } = openDatabase(join(directory, "db.sqlite"), join(process.cwd(), "packages/db/migrations"));
  try {
    repository.seedPlatformCatalog(join(process.cwd(), "PLATFORMS.csv"));
    const id = randomUUID();
    const account = repository.registerScopedBrowserAccount({ id, platformKey: "xiaohongshu", name: "Test XHS Account" });
    expect(account).toMatchObject({ id, platformKey: "xiaohongshu", loginStatus: "unknown" });
    expect(repository.getAccountAuthorization(id, "xiaohongshu")).toBeNull();
    expect(repository.registerScopedBrowserAccount({ id, platformKey: "xiaohongshu", name: "Test XHS Account" }).id).toBe(id);
    expect(() => repository.registerScopedBrowserAccount({ id, platformKey: "xiaohongshu", name: "Other" })).toThrow();
  } finally { db.close(); }
});
