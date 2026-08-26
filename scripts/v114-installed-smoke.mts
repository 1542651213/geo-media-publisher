import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const executablePath = process.env.V115_INSTALLED_EXE ?? "C:\\GMP115PublishSmoke\\Geo Media Publisher.exe";
const workbookPath = process.env.V115_WORKBOOK ?? "D:\\Downloads\\康一环保_木渎推广文章100篇_兼容导入版.xlsx";
const evidenceDirectory = join(process.cwd(), "output", "playwright", "v115-installed-smoke");
mkdirSync(evidenceDirectory, { recursive: true });

const result: Record<string, unknown> = {
  executablePath,
  workbookPath,
  startedAt: new Date().toISOString(),
  finalPublishClicked: false,
  importConfirmed: false
};

const electronApp = await electron.launch({ executablePath, timeout: 30_000 });
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("heading", { name: "首页", exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(7_000);

  const startupText = await page.locator("body").innerText();
  result.startup = {
    dashboardVisible: startupText.includes("内容运营工作台"),
    reminderOnly: startupText.includes("平台页面不会自动打开。"),
    zhihuReloginReminder: startupText.includes("知乎需要重新登录")
  };
  await page.screenshot({ path: join(evidenceDirectory, "01-startup-dashboard.png"), fullPage: false, timeout: 10_000 });

  await electronApp.evaluate(`({ dialog }, selectedWorkbook) => {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: function () { return Promise.resolve({ canceled: false, filePaths: [selectedWorkbook], bookmarks: [] }); }
    });
  }`, workbookPath);

  await page.getByRole("button", { name: /文章库/u }).first().click();
  await page.getByRole("heading", { name: "管理可发布的文章" }).waitFor({ timeout: 20_000 });
  const importButton = page.getByRole("button", { name: "Excel 导入", exact: true });
  await importButton.waitFor();
  if (await importButton.isDisabled()) throw new Error("Excel 导入按钮仍被禁用，未选择默认企业");
  await importButton.click();
  await page.getByRole("heading", { name: "确认导入文章" }).waitFor({ timeout: 30_000 });

  const importMetrics = await page.locator(".v114-import-summary button").allInnerTexts();
  const importRows = page.locator(".v114-import-row");
  const importRowCount = await importRows.count();
  const firstRows = await importRows.evaluateAll((rows) => rows.slice(0, 3).map((row) => row.textContent?.replace(/\s+/gu, " ").trim() ?? ""));
  const confirmImportText = await page.getByRole("button", { name: /确认导入/u }).innerText();
  const workbookLabel = await page.locator(".v114-import-drawer .drawer-head small").innerText();
  result.excel = { importMetrics, importRowCount, firstRows, confirmImportText, workbookLabel };
  await page.screenshot({ path: join(evidenceDirectory, "02-excel-100-preview.png"), fullPage: false, timeout: 10_000 });
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("button", { name: /账号中心/u }).first().click();
  await page.getByRole("heading", { name: "管理全部发布平台" }).waitFor({ timeout: 20_000 });
  const zhihuCard = page.locator(".v11-account-card").filter({ hasText: "知乎" }).first();
  const reloginButton = zhihuCard.getByRole("button", { name: "重新登录", exact: true });
  result.loginLifecycle = { attempted: false, succeeded: false, failureKeptOpenUntilCancel: false };
  if (await reloginButton.count()) {
    await reloginButton.click();
    const loginHeading = page.getByRole("heading", { name: "完成知乎登录" });
    try {
      await loginHeading.waitFor({ timeout: 30_000 });
      result.loginLifecycle = { attempted: true, succeeded: false, failureKeptOpenUntilCancel: false };
      await page.getByRole("button", { name: "我已完成登录", exact: true }).click();
      const loginOutcome = await Promise.race([
        page.locator(".v114-login-success").waitFor({ timeout: 45_000 }).then(() => "success" as const),
        page.locator(".v114-login-dialog .notice.error").waitFor({ timeout: 45_000 }).then(() => "failure" as const)
      ]);
      if (loginOutcome === "success") {
        const successText = await page.locator(".v114-login-success").innerText();
        result.loginLifecycle = { attempted: true, succeeded: true, successText, failureKeptOpenUntilCancel: false };
        await page.screenshot({ path: join(evidenceDirectory, "03-login-success.png"), fullPage: false, timeout: 10_000 });
        await page.getByRole("button", { name: "完成", exact: true }).click();
      } else {
        const failureText = await page.locator(".v114-login-dialog .notice.error").innerText();
        result.loginLifecycle = { attempted: true, succeeded: false, failureText, failureKeptOpenUntilCancel: true };
        await page.screenshot({ path: join(evidenceDirectory, "03-login-waiting.png"), fullPage: false, timeout: 10_000 });
        await page.getByRole("button", { name: "取消连接", exact: true }).click();
      }
    } catch (error) {
      result.loginLifecycle = {
        attempted: true,
        succeeded: false,
        failureKeptOpenUntilCancel: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const selfTestButton = page.getByRole("button", { name: "平台自测", exact: true }).first();
  await selfTestButton.click();
  await page.getByRole("heading", { name: "平台自测中心" }).waitFor({ timeout: 20_000 });
  const selfTestHead = page.locator(".self-test-table-head > span");
  const selfTestColumnCount = await selfTestHead.count();
  const selfTestNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const zhihuRow = page.locator(".self-test-table-row").filter({ hasText: "知乎" }).first();
  const backgroundButton = zhihuRow.getByRole("button", { name: "自测 L1–L3", exact: true });
  await backgroundButton.click();
  await page.locator(".notice").filter({ hasText: "自测已记录" }).waitFor({ timeout: 180_000 });
  const selfTestMessage = await page.locator(".notice").filter({ hasText: "自测已记录" }).innerText();
  const selfTestRow = (await zhihuRow.innerText()).replace(/\s+/gu, " ").trim();
  result.zhihuSelfTest = { selfTestMessage, selfTestRow, selfTestColumnCount, selfTestNoHorizontalOverflow };
  await page.screenshot({ path: join(evidenceDirectory, "04-zhihu-background-self-test.png"), fullPage: false, timeout: 10_000 });
} finally {
  await electronApp.close();
  result.finishedAt = new Date().toISOString();
}

console.log(`V115_INSTALLED_SMOKE=${JSON.stringify(result)}`);
