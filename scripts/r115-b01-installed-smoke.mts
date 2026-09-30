import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const base = join(process.cwd(), "output", "b01-candidate-smoke");
const isolatedAppData = join(base, "b01-isolated-user-data");
const executablePath = process.env.B01_INSTALLED_EXE ?? join(process.cwd(), "output", "b01-candidate-install-isolated", "Geo Media Publisher.exe");
const expected = ["抖音", "小红书", "官网", "今日头条", "搜狐号", "网易号", "百家号", "微博", "列举网", "博客园"];
mkdirSync(isolatedAppData, { recursive: true });
if (!existsSync(executablePath)) throw new Error(`Candidate installed executable missing: ${executablePath}`);

const productionDb = join(process.env.APPDATA ?? "", "codex-media-publisher", "production-data", "publisher.db");
const productionMtime = existsSync(productionDb) ? statSync(productionDb).mtimeMs : null;
const isolatedDb = join(isolatedAppData, "production-data", "publisher.db");
const result: Record<string, unknown> = { executablePath, isolatedAppData, realPlatformAccess: false, realPublishCount: 0,
  finalSubmitCountCreated: 0, productionDatabaseUnchanged: false };

async function inspect(restart: boolean): Promise<void> {
  const electronApp = await electron.launch({ executablePath, timeout: 30_000, env: {
    ...process.env, GMP_B01_ISOLATED_USER_DATA_DIR: isolatedAppData, PUBLISHER_DATA_MODE: "production", ELECTRON_RENDERER_URL: "",
    DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED: "false", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "false"
  } });
  try {
    const page = await electronApp.firstWindow({ timeout: 30_000 });
    await page.getByRole("heading", { name: "今天的内容运营" }).waitFor({ timeout: 30_000 });
    const dashboard = await page.locator(".v11-platform-overview > div > strong").allTextContents();
    if (JSON.stringify(dashboard) !== JSON.stringify(expected)) throw new Error(`Dashboard platform mismatch: ${dashboard.join(",")}`);
    if (!restart) {
      await page.screenshot({ path: join(base, "01-dashboard.png"), timeout: 10_000 });
      await page.locator(".sidebar .nav-item").filter({ hasText: "账号中心" }).click();
      await page.getByRole("heading", { name: "管理运营平台" }).waitFor();
      await page.getByRole("button", { name: "全部平台" }).click();
      const accountText = await page.locator(".content-area").innerText();
      if (!accountText.includes("按产品顺序展示 10 个运营平台") || accountText.includes("知乎"))
        throw new Error("Account center platform policy mismatch");
      result.accountCenter = "10 platforms; hidden platforms absent";

      await page.locator(".sidebar .nav-item").filter({ hasText: "发布中心" }).click();
      await page.getByRole("heading", { name: "安排并开始发布" }).waitFor();
      await page.getByRole("button", { name: "选择文章发布" }).click();
      await page.getByRole("heading", { name: "选择发布渠道" }).waitFor();
      const rows = await page.locator(".v11-channel-list .check-row").allTextContents();
      if (rows.length !== 10 || expected.some((name, index) => !rows[index]?.includes(name)))
        throw new Error(`Publish drawer platform order mismatch: ${rows.join("|")}`);
      const checks = page.locator(".v11-channel-list input[type=checkbox]");
      for (let index = 0; index < 10; index += 1) if (!await checks.nth(index).isDisabled())
        throw new Error(`Platform ${expected[index]} unexpectedly publishable without authorization`);
      const methods = await page.evaluate(() => Object.keys(window.publisherAPI.b01).sort());
      if (JSON.stringify(methods) !== JSON.stringify(["eligibility", "jobStatus"])) throw new Error(`Renderer exposes B01 mutation: ${methods}`);
      const diagnostic = await page.evaluate(async () => {
        try { await window.publisherAPI.platformSelfTest.confirmPublish("forged-b01-test-run"); return "UNEXPECTED_SUCCESS"; }
        catch (error) { return String(error); }
      });
      if (!diagnostic.includes("B01_DIAGNOSTIC_SUBMIT_DISABLED")) throw new Error(`Diagnostic submit IPC was not blocked: ${diagnostic}`);
      result.diagnosticSubmit = "blocked by Main before platform access";
      result.publishDrawer = "10 ordered platforms; all disabled without grant";
      result.rendererB01Methods = methods;
      await page.screenshot({ path: join(base, "02-publish-drawer.png"), timeout: 10_000 });
      await page.getByRole("button", { name: "×" }).last().click();

      await page.locator(".sidebar .nav-item").filter({ hasText: "数据统计" }).click();
      await page.getByRole("heading", { name: "查看内容运营结果" }).waitFor();
      const statistics = await page.locator(".v11-platform-overview > div > strong").allTextContents();
      if (JSON.stringify(statistics) !== JSON.stringify(expected)) throw new Error(`Statistics platform mismatch: ${statistics.join(",")}`);
      result.statistics = "10 ordered platforms";
      await page.screenshot({ path: join(base, "03-statistics.png"), timeout: 10_000 });
    }
    result[restart ? "restartDashboard" : "dashboard"] = dashboard;
  } finally { await electronApp.close(); }
}

await inspect(false);
if (!existsSync(isolatedDb)) throw new Error("Isolated Candidate database was not created");
await inspect(true);
result.restartRecovery = "same isolated database and ten-platform dashboard after restart";
result.productionDatabaseUnchanged = productionMtime === (existsSync(productionDb) ? statSync(productionDb).mtimeMs : null);
if (!result.productionDatabaseUnchanged) throw new Error("Production database mtime changed during isolated smoke");
console.log(`B01_INSTALLED_SMOKE=${JSON.stringify(result)}`);
