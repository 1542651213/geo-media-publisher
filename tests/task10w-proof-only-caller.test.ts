import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rendererSource = readFileSync("apps/desktop/src/renderer/PlatformSelfTestCenter.tsx", "utf8");
const preloadSource = readFileSync("apps/desktop/src/main/preload.ts", "utf8");
const sharedApiSource = readFileSync("apps/desktop/src/shared/api.ts", "utf8");

describe("Task10W proof-only renderer caller", () => {
  it("has a dedicated action that invokes the selected account probe", () => {
    const action = rendererSource.match(/const runXhsCanonicalProbe[\s\S]*?\n {2}};\n/);

    expect(action, "renderer proof-only caller is missing").not.toBeNull();
    expect(action?.[0]).toContain("probeXhsCanonicalPage(key)");
    expect(action?.[0]).not.toContain("verifyAndConvergeXhsIdentity");
    expect(action?.[0]).not.toContain("probeXhsCanonicalPage({");
    expect(action?.[0]).not.toMatch(/observedCreatorIdNormalized|expectedCreatorId|pageUrlConsistency/);
  });

  it("keeps the account binding inside the typed preload boundary", () => {
    expect(sharedApiSource).toContain("probeXhsCanonicalPage(accountId: string): Promise<XiaohongshuCanonicalPageRuntimeProbe>");
    expect(preloadSource).toContain("probeXhsCanonicalPage: (accountId) => invoke(\"platform-self-test:probe-xhs-canonical-page\", { accountId })");
    expect(preloadSource).not.toMatch(/probeXhsCanonicalPage: \(.*(?:url|selector|script|pageId|contextId)/i);
  });

  it("renders the proof-only action for every usable XHS account", () => {
    expect(rendererSource).toContain("view.account.platformKey === \"xiaohongshu\"");
    expect(rendererSource).toContain("只读身份验证");
  });
});
