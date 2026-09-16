import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("V1.0.1.1 packaged browser runtime contract", () => {
  it("declares playwright-core as a production dependency at every runtime boundary", () => {
    const rootPackage = readJson(join(root, "package.json"));
    const rootDependencies = rootPackage.dependencies as Record<string, string>;
    const corePackage = readJson(join(root, "packages", "adapters", "core", "package.json"));
    const coreDependencies = corePackage.dependencies as Record<string, string>;
    const browserPackage = readJson(join(root, "packages", "adapters", "browser", "package.json"));
    const browserDependencies = browserPackage.dependencies as Record<string, string>;

    expect(rootDependencies["playwright-core"]).toBeTruthy();
    expect(coreDependencies["playwright-core"]).toBeTruthy();
    expect(rootDependencies.playwright).toBeUndefined();
    expect(coreDependencies.playwright).toBeUndefined();
    expect(browserDependencies.playwright).toBeUndefined();
    expect(existsSync(join(root, "node_modules", "playwright-core", "package.json"))).toBe(true);
  });

  it("keeps the packaged main bundle external only to the production runtime package", () => {
    const bundler = readFileSync(join(root, "electron.vite.config.ts"), "utf8");
    const sessionManager = readFileSync(join(root, "packages", "adapters", "core", "src", "browser.ts"), "utf8");
    const packageJson = readJson(join(root, "package.json"));
    const build = packageJson.build as { files?: string[]; asarUnpack?: string[] };

    expect(bundler).toContain('"playwright-core"');
    expect(bundler).not.toContain('"playwright",');
    expect(sessionManager).toContain('import("playwright-core")');
    expect(sessionManager).not.toContain('import("playwright")');
    expect(build.files).toContain("node_modules/**/*");
    expect(build.asarUnpack).not.toContain("node_modules/**/*");
  });
});
