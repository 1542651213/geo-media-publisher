import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const diagnostic = readFileSync("packages/adapters/xiaohongshu/src/editor-load-diagnostic.ts", "utf8");
const browser = readFileSync("packages/adapters/xiaohongshu/src/browser.ts", "utf8");
const ipc = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
const preload = readFileSync("apps/desktop/src/main/preload.ts", "utf8");
const api = readFileSync("apps/desktop/src/shared/api.ts", "utf8");

describe("Task10S XHS editor load diagnostic wiring", () => {
  it("exposes one typed fixed-route diagnostic through the existing account API", () => {
    expect(api).toContain("inspectEditorLoad(accountId: string, platformKey: string)");
    expect(preload).toContain('inspectEditorLoad: (accountId, platformKey) => invoke("accounts:editor-load-diagnostic", { accountId, platformKey })');
    expect(ipc).toContain('register("accounts:editor-load-diagnostic"');
    expect(ipc).toContain('platformKey: z.literal("xiaohongshu")');
    expect(browser).toContain("runXhsEditorLoadDiagnostic(canonical.page");
  });

  it("keeps the diagnostic bounded and prevents arbitrary browser control", () => {
    expect(diagnostic).toContain("MAX_RELOAD_COUNT = 1");
    expect(diagnostic).toContain("MAX_WAIT_MS = 30_000");
    expect(diagnostic).toContain("page.reload({ waitUntil: \"commit\"");
    expect(diagnostic).not.toContain("page.goto(");
    expect(diagnostic).not.toContain("page.newPage(");
    expect(diagnostic).not.toContain("context.newPage(");
    expect(diagnostic).not.toContain("new BrowserContext");
    expect(diagnostic).not.toContain("document.body.innerText");
    expect(diagnostic).not.toContain("document.documentElement.innerHTML");
    expect(diagnostic).not.toContain("localStorage");
    expect(diagnostic).not.toContain("sessionStorage");
  });
});
