import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportLogBundle } from "@publisher/logger";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("sanitized diagnostics export", () => {
  it("writes a zip bundle without secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-logs-")); dirs.push(dir);
    const log = join(dir, "application.log"); const output = join(dir, "diagnostics.zip");
    writeFileSync(log, JSON.stringify({ apiKey: "secret-value", message: "ok" }));
    await exportLogBundle({ outputPath: output, applicationLogPath: log, diagnostics: { authorization: "Bearer secret" } });
    const data = readFileSync(output).toString("utf8");
    expect(data).toContain("sanitized-diagnostics.json");
    expect(data).not.toContain("secret-value");
  });
});
