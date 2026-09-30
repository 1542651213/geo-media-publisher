import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import * as XLSX from "xlsx";
import { openDatabase } from "@publisher/db";

const projectRoot = process.cwd();
const root = join(projectRoot, "output", "b01-candidate-r3-smoke", String(Date.now()));
const userData = join(root, "b01-isolated-user-data");
const dataDir = join(userData, "production-data");
const executablePath = join(projectRoot, "output", "b01-candidate-r3-install-isolated", "Geo Media Publisher.exe");
const productionDb = join(process.env.APPDATA ?? "", "codex-media-publisher", "production-data", "publisher.db");
const productionBefore = existsSync(productionDb) ? { size: statSync(productionDb).size, mtimeMs: statSync(productionDb).mtimeMs } : null;
if (!existsSync(executablePath)) throw new Error("Installed R3 executable missing");
mkdirSync(dataDir, { recursive: true });
const marker = `GMP-R115-B01-${Date.now()}`;
const imageFixture = join(projectRoot, "output", "b01-real-product-e2e", "kangyi-indoor-air-20260930124457.png");
if (!existsSync(imageFixture)) throw new Error("Local isolated image fixture missing");
const imagePath = join(root, "isolated-image.png");
copyFileSync(imageFixture, imagePath);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["标题", "内容"],
  [`${marker} 室内空气治理服务介绍`, `${marker} 江苏康一环保科技有限公司提供室内空气治理相关服务。具体方案应依据现场情况确认。`]]), "文章");
const excelPath = join(root, "isolated-article.xlsx");
writeFileSync(excelPath, XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
const dbPath = join(dataDir, "publisher.db");
const migrations = join(projectRoot, "packages", "db", "migrations");
// Playwright serializes this function into packaged Main; a fixed function body avoids tsx helper closures.
const selectIsolatedFile = new Function("electron", "filePath",
  "electron.dialog.showOpenDialog = async function () { return { canceled: false, filePaths: [filePath] }; };") as unknown as
  (electronModule: typeof import("electron"), filePath: string) => void;
const confirmIsolatedGrant = new Function("electron",
  "electron.dialog.showMessageBox = async function () { return { response: 1, checkboxChecked: false }; };") as unknown as
  (electronModule: typeof import("electron")) => void;
const stagingPath = join(root, "staging.db");
const seed = openDatabase(stagingPath, migrations);
seed.repository.seedPlatformCatalog(join(projectRoot, "PLATFORMS.csv"));
seed.repository.setSetting("contentReviewMode", "Off");
seed.repository.createBrand({ name: "First isolated company", companyName: "First isolated company" });
const brand = seed.repository.createBrand({ name: "Selected isolated company", companyName: "Selected isolated company" });
const account = seed.repository.createAccount({ platformKey: "douyin", name: "Isolated B01 account" });
seed.repository.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "isolated-only", browserSessionIdHash: "isolated-only" });
seed.db.close();
copyFileSync(stagingPath, dbPath);

async function launch(inspect: (page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>,
  app: Awaited<ReturnType<typeof electron.launch>>) => Promise<void>): Promise<void> {
  const app = await electron.launch({ executablePath, timeout: 30_000, args: [`--b01-isolated-smoke=${marker}`], env: {
    ...process.env, GMP_B01_ISOLATED_USER_DATA_DIR: userData, PUBLISHER_DATA_MODE: "production",
    ELECTRON_RENDERER_URL: "", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "false"
  } });
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.getByRole("heading", { name: "今天的内容运营" }).waitFor({ timeout: 30_000 });
    await inspect(page, app);
  } finally { await app.close(); }
}

await launch(async (page, app) => {
  const availability = await page.evaluate(() => window.publisherAPI.b01.availability());
  if (!availability.enabled) throw new Error("R3 package marker not active");
  await page.locator(".sidebar .nav-item").filter({ hasText: "文章库" }).click();
  await page.getByRole("heading", { name: "管理可发布的文章" }).waitFor();
  await page.locator(".v114-import-actions select").selectOption(brand.id);
  await app.evaluate(selectIsolatedFile, excelPath);
  await page.getByRole("button", { name: "Excel 导入" }).click();
  await page.getByRole("heading", { name: "确认导入文章" }).waitFor();
  await page.getByRole("button", { name: "确认导入 1 篇" }).click();
  await page.locator(".v11-article-row").filter({ hasText: marker }).waitFor();

  await page.locator(".sidebar .nav-item").filter({ hasText: "图片库" }).click();
  await page.getByRole("heading", { name: "让文章使用相关图片" }).waitFor();
  const company = page.locator(".v11-image-upload select");
  await company.selectOption(brand.id);
  await page.waitForTimeout(300);
  if (await company.inputValue() !== brand.id) throw new Error("Selected company reset before import");
  await app.evaluate(selectIsolatedFile, imagePath);
  await page.getByRole("button", { name: "上传图片" }).click();
  await page.locator(".v111-image-editor").waitFor();
  if (await company.inputValue() !== brand.id) throw new Error("Selected company reset while editing image");
  await page.locator(".v111-image-editor").getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已上传并保存 1 张图片").waitFor();
  if (await company.inputValue() !== brand.id) throw new Error("Selected company reset after import");
  await page.locator(".image-asset-card").first().waitFor();
});

const inspectedPath = join(root, "inspected.db");
copyFileSync(dbPath, inspectedPath);
const inspect = openDatabase(inspectedPath, migrations);
const articles = inspect.repository.listArticles({ source: "excel_import" }).filter((article) => article.title.includes(marker));
if (articles.length !== 1 || !articles[0]?.body.includes(marker)) throw new Error("Normal UI Article missing or wrong source/marker");
const article = articles[0];
const images = inspect.repository.listImageAssets(brand.id);
if (images.length !== 1 || images[0]?.brandId !== brand.id) throw new Error("Normal UI image missing or wrong company");
const image = images[0];
const actualHash = createHash("sha256").update(readFileSync(image.filePath)).digest("hex");
if (image.sha256 !== actualHash || actualHash !== createHash("sha256").update(readFileSync(imagePath)).digest("hex"))
  throw new Error("Main import SHA256 mismatch");
if (inspect.repository.listJobs().length !== 0 || inspect.repository.getB01Authorization()) throw new Error("Smoke unexpectedly created Job or grant");
inspect.db.close();

await launch(async (page, app) => {
  await page.locator(".sidebar .nav-item").filter({ hasText: "图片库" }).click();
  const company = page.locator(".v11-image-upload select");
  await company.selectOption(brand.id);
  await page.waitForTimeout(300);
  if (await company.inputValue() !== brand.id || await page.locator(".image-asset-card").count() !== 1)
    throw new Error("Restart image company context failed");
  await page.locator(".sidebar .nav-item").filter({ hasText: "发布中心" }).click();
  await page.getByRole("button", { name: "选择文章发布" }).click();
  await page.locator(".v11-publish-drawer select").first().selectOption(article.id);
  await page.getByRole("button", { name: "手动选择" }).click();
  await page.getByRole("button", { name: image.name }).click();
  await page.getByLabel("B01 唯一测试账号").selectOption(account.id);
  const binding = { accountId: account.id, articleId: article.id, imageAssetId: image.id };
  if ((await page.evaluate((input) => window.publisherAPI.b01.eligibility(input), binding)).eligible)
    throw new Error("B01 eligible without authorization");
  await app.evaluate(confirmIsolatedGrant);
  await page.getByRole("button", { name: "申请创建 B01 单次验收授权" }).click();
  await page.getByText("仅当前测试账号、文章和图片可进行一次 B01 产品验收").waitFor();
  if (!(await page.evaluate((input) => window.publisherAPI.b01.eligibility(input), binding)).eligible)
    throw new Error("Normal UI/Main B01 authorization not eligible");
  const diagnostic = await page.evaluate(async () => {
    try { await window.publisherAPI.platformSelfTest.confirmPublish("isolated-fake"); return false; }
    catch (error) { return String(error).includes("B01_DIAGNOSTIC_SUBMIT_DISABLED"); }
  });
  if (!diagnostic) throw new Error("Diagnostic final action bypass");
});

const boundPath = join(root, "bound.db");
copyFileSync(dbPath, boundPath);
const bound = openDatabase(boundPath, migrations);
const auth = bound.repository.getB01Authorization();
if (!auth || auth.status !== "Created" || auth.articleId !== article.id || auth.imageAssetId !== image.id
  || auth.accountId !== account.id || auth.imageSha256 !== actualHash) throw new Error("Main authorization binding failed");
const job = bound.repository.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
  selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
  douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } });
let secondBlocked = false;
try { bound.repository.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
  selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
  douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } }); }
catch { secondBlocked = true; }
if (!secondBlocked || bound.repository.getSubmissionIntentByJob(job.id)
  || bound.repository.getB01Authorization()?.jobId !== job.id) throw new Error("Unique Job binding failed");
bound.db.close();
copyFileSync(boundPath, dbPath);

await launch(async (page) => {
  if ((await page.evaluate((jobId) => window.publisherAPI.b01.jobStatus(jobId), job.id)).status !== "Bound")
    throw new Error("Restart one-shot authorization status failed");
  const rows = await page.evaluate((brandId) => window.publisherAPI.imageAssets.list({ brandId }), brand.id);
  if (rows.length !== 1 || rows[0]?.sha256 !== actualHash) throw new Error("Restart image hash/company failed");
});

const productionAfter = existsSync(productionDb) ? { size: statSync(productionDb).size, mtimeMs: statSync(productionDb).mtimeMs } : null;
if (JSON.stringify(productionBefore) !== JSON.stringify(productionAfter)) throw new Error("Production DB metadata changed");
console.log(JSON.stringify({ result: "B01_R3_INSTALLED_SMOKE_PASS", articleId: article.id, imageId: image.id,
  imageSha256: actualHash, authorizationStatus: "Bound", jobId: job.id, companyPreserved: true,
  finalSubmitCountCreated: 0, realPlatformAccess: false, productionDbUnchanged: true }));
