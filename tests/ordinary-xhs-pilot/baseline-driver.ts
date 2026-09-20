import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { _electron } from "playwright-core";

/** Explicitly called by the isolated runner; importing this module never launches a process. */
export async function runOrdinaryUiBaseline(input: { executablePath: string; executableSha256: string; entryPath: string; runDir: string }): Promise<void> {
  const root = "D:/GEO/repairs/batch1-v0-f01-20260917";
  const expectedExe = resolve(root, "electron-runtime/dist/electron.exe");
  assert.equal(resolve(input.executablePath).toLowerCase(), expectedExe.toLowerCase());
  assert.equal(createHash("sha256").update(readFileSync(expectedExe)).digest("hex"), input.executableSha256.toLowerCase());
  assert.ok(resolve(input.runDir).toLowerCase().startsWith(resolve(root, "runtime/ordinary-xhs-pilot").toLowerCase() + "\\"));
  assert.ok(!existsSync(join(input.runDir, "publisher.db")), "fresh synthetic DB required");
  mkdirSync(input.runDir, { recursive: true });
  const app = await _electron.launch({ executablePath: expectedExe, args: [resolve(input.entryPath)], cwd: resolve(root, "source"), timeout: 30000, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE")), ORDINARY_XHS_BASELINE: "SYNTHETIC_ONLY", ORDINARY_XHS_BASELINE_DIR: resolve(input.runDir), NODE_PATH: resolve(root, "source/node_modules") } });
  let page: Awaited<ReturnType<typeof app.firstWindow>> | undefined;
  const errors: string[] = [];

  let step = "article-library";
  try {
    page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: /文章库/u }).first().click();
    const row = page.locator(".v11-article-row").filter({ hasText: "普通文章离线验收" });
    await row.getByRole("button", { name: "发布", exact: true }).click();
    step = "explicit-channel";
    const drawer = page.locator(".v11-publish-drawer");
    const xhs = drawer.locator("label.check-row").filter({ hasText: "小红书" });
    await xhs.getByRole("checkbox").check();
    step = "explicit-image";
    await drawer.getByRole("button", { name: "手动选择", exact: true }).click();
    await drawer.locator(".v111-manual-images").getByRole("button", { name: "明确单图" }).click();
    await page.screenshot({ path: join(input.runDir, "before-prepare.png"), fullPage: true });
    step = "prepare";
    await drawer.getByRole("button", { name: /^(开始发布|仍然发布|准备内容)$/u }).click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("正在发布")), undefined, { timeout: 15000 });
    const uiText = await drawer.innerText();
    const jobs = await page.evaluate(() => window.publisherAPI.jobs.list());
    await page.screenshot({ path: join(input.runDir, "after-prepare.png"), fullPage: true });
    const evidence = { kind: "ACTUAL_ELECTRON_BASELINE", step, expected: "blocked preparation must not claim prepared", uiText, jobs, errors };
    writeFileSync(join(input.runDir, "ui-baseline.json"), JSON.stringify(evidence, null, 2));
    assert.ok(!uiText.includes("内容已准备"), "UI incorrectly reports preparation complete after synthetic boundary refused preparation");
    assert.ok(/验证|未.*准备|未返回|失败|阻断/u.test(uiText), "UI must explain blocked prepare");
  } catch (error) {
    writeFileSync(join(input.runDir, "ui-baseline-failure.json"), JSON.stringify({ step, error: error instanceof Error ? error.message : String(error), errors, uiText: page ? await page.locator("body").innerText() : "NO_WINDOW" }, null, 2));
    await page?.screenshot({ path: join(input.runDir, "baseline-failure.png"), fullPage: true });
    throw error;
  } finally { await app.close(); }
}
