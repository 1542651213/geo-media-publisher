import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { _electron as electron } from "playwright-core";
import { openDatabase } from "@publisher/db";

const root = join(process.cwd(), "output", "b01-candidate-r2-smoke", String(Date.now()));
const executablePath = join(process.cwd(), "output", "b01-candidate-r2-install-isolated", "Geo Media Publisher.exe");
const productionDb = join(process.env.APPDATA ?? "", "codex-media-publisher", "production-data", "publisher.db");
const productionBefore = existsSync(productionDb) ? { size: statSync(productionDb).size, mtimeMs: statSync(productionDb).mtimeMs } : null;
if (!existsSync(executablePath)) throw new Error("Installed R2 Candidate missing");
mkdirSync(root, { recursive: true });
const imagePath = join(root, "b01-fixture.png");
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7h8AAAAASUVORK5CYII=", "base64");
writeFileSync(imagePath, imageBytes);
const stagingPath = join(root, "staging.db");
const migrations = join(process.cwd(), "packages", "db", "migrations");
const opened = openDatabase(stagingPath, migrations);
const repo = opened.repository;
repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
repo.setSetting("contentReviewMode", "Off");
const brand = repo.createBrand({ name: "B01 isolated R2", companyName: "B01 isolated R2" });
const account = repo.createAccount({ platformKey: "douyin", name: "B01 isolated account" });
repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "isolated-only", browserSessionIdHash: "isolated-only" });
const marker = `GMP-R115-B01-${Date.now()}`;
const article = repo.createArticle({ brandId: brand.id, title: `${marker} title`, body: `${marker} body`, summary: "", tags: [],
  seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
  generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: createHash("sha256").update(marker).digest("hex"), source: "production" });
if (!article) throw new Error("Fixture Article missing");
const image = repo.createImageAsset({ brandId: brand.id, name: "B01 isolated image", filePath: imagePath,
  originalFileName: "b01-fixture.png", mimeType: "image/png", size: imageBytes.length });
if (repo.getB01Authorization()) throw new Error("Fixture unexpectedly authorized");
opened.db.close();

function isolatedData(name: string, source: string): string {
  const userData = join(root, name, "b01-isolated-user-data");
  const dataDir = join(userData, "production-data");
  mkdirSync(dataDir, { recursive: true });
  copyFileSync(source, join(dataDir, "publisher.db"));
  return userData;
}
const firstUserData = isolatedData("created", stagingPath);
const expectedPlatforms = ["抖音", "小红书", "官网", "今日头条", "搜狐号", "网易号", "百家号", "微博", "列举网", "博客园"];

async function launch(userData: string, inspect: (page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>,
  app: Awaited<ReturnType<typeof electron.launch>>) => Promise<void>): Promise<void> {
  const app = await electron.launch({ executablePath, timeout: 30_000, args: [`--b01-isolated-smoke=${marker}`], env: { ...process.env,
    GMP_B01_ISOLATED_USER_DATA_DIR: userData, PUBLISHER_DATA_MODE: "production", ELECTRON_RENDERER_URL: "",
    REAL_PUBLISH_TEST_BATCH_CONFIRMED: "false" } });
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.getByRole("heading", { name: "今天的内容运营" }).waitFor({ timeout: 30_000 });
    await inspect(page, app);
  } finally { await app.close(); }
}

await launch(firstUserData, async (page) => {
  const dashboard = await page.locator(".v11-platform-overview > div > strong").allTextContents();
  if (JSON.stringify(dashboard) !== JSON.stringify(expectedPlatforms)) throw new Error("R2 platform whitelist mismatch");
  const availability = await page.evaluate(() => window.publisherAPI.b01.availability());
  if (!availability.enabled) throw new Error("R2 Main capability marker missing");
  const exact = { accountId: account.id, articleId: article.id, imageAssetId: image.id };
  if ((await page.evaluate((input) => window.publisherAPI.b01.eligibility(input), exact)).eligible)
    throw new Error("Douyin eligible without authorization");
  const methods = await page.evaluate(() => Object.keys(window.publisherAPI.b01).sort());
  if (methods.some((name) => /grant|set|consume|revoke/iu.test(name))) throw new Error("Renderer exposes direct authorization mutation");
  await page.locator(".sidebar .nav-item").filter({ hasText: "发布中心" }).click();
  await page.getByRole("button", { name: "选择文章发布" }).click();
  await page.locator(".v11-publish-drawer select").first().selectOption(article.id);
  await page.getByRole("button", { name: "手动选择" }).click();
  await page.getByRole("button", { name: "B01 isolated image" }).click();
  await page.getByLabel("B01 唯一测试账号").selectOption(account.id);
  const confirmation = spawn("pwsh.exe", ["-NoProfile", "-File",
    join(process.cwd(), "scripts", "r115-b01-r2-confirm-isolated-dialog.ps1"),
    "-CandidatePath", executablePath, "-SmokeToken", marker], { windowsHide: true });
  const confirmationDone = new Promise<void>((resolve, reject) => {
    let output = "";
    confirmation.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    confirmation.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    confirmation.on("exit", (code) => code === 0 && output.includes("ISOLATED_B01_MAIN_DIALOG_CONFIRMED=YES")
      ? resolve() : reject(new Error(`Isolated Main confirmation failed: ${output}`)));
  });
  await page.getByRole("button", { name: "申请创建 B01 单次验收授权" }).click();
  await confirmationDone;
  await page.getByText("仅当前测试账号、文章和图片可进行一次 B01 产品验收").waitFor({ timeout: 15_000 });
  if (!(await page.evaluate((input) => window.publisherAPI.b01.eligibility(input), exact)).eligible)
    throw new Error("Main-created B01 authorization not eligible");
  const wrong = await page.evaluate((input) => Promise.all([
    window.publisherAPI.b01.eligibility({ ...input, accountId: "wrong" }),
    window.publisherAPI.b01.eligibility({ ...input, articleId: "wrong" }),
    window.publisherAPI.b01.eligibility({ ...input, imageAssetId: "wrong" })
  ]), exact);
  if (wrong.some((item) => item.eligible)) throw new Error("Wrong binding eligible");
  const forged = await page.evaluate(async () => {
    try { await window.publisherAPI.b01.requestAuthorization({ platformKey: "weibo" as "douyin", accountId: "wrong", articleId: "wrong", imageAssetId: "wrong" }); return false; }
    catch { return true; }
  });
  if (!forged) throw new Error("Non-Douyin grant accepted");
  const diagnostic = await page.evaluate(async () => {
    try { await window.publisherAPI.platformSelfTest.confirmPublish("forged-b01"); return false; }
    catch (error) { return String(error).includes("B01_DIAGNOSTIC_SUBMIT_DISABLED"); }
  });
  if (!diagnostic) throw new Error("Diagnostic submit bypass");
});

const isolatedDb = join(firstUserData, "production-data", "publisher.db");
const boundStage = join(root, "bound-staging.db");
copyFileSync(isolatedDb, boundStage);
const bound = openDatabase(boundStage, migrations);
const auth = bound.repository.getB01Authorization();
if (!auth || auth.status !== "Created" || auth.jobId || auth.finalAuthorizedAt
  || auth.imageSha256 !== createHash("sha256").update(imageBytes).digest("hex")) throw new Error("Main authorization persistence mismatch");
const job = bound.repository.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
  selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
  douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } });
let secondJobBlocked = false;
try { bound.repository.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
  selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
  douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } }); }
catch { secondJobBlocked = true; }
if (!secondJobBlocked) throw new Error("Second B01 Job accepted");
bound.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.id,
  platformKey: "douyin", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false,
  response: { fixture: "prepared without platform access" }, status: "Prepared", publishMode: "ASSISTED",
  automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });
bound.repository.markB01Prepared(job.id);
if (bound.repository.getSubmissionIntentByJob(job.id)) throw new Error("Prepared unexpectedly created Intent");
bound.db.close();
copyFileSync(boundStage, isolatedDb);

await launch(firstUserData, async (page) => {
  const status = await page.evaluate((jobId) => window.publisherAPI.b01.jobStatus(jobId), job.id);
  if (status.eligible || status.status !== "Prepared") throw new Error("Prepared restart status mismatch");
  const approvalBlocked = await page.evaluate(async (jobId) => {
    try { await window.publisherAPI.b01.requestFinalApproval(jobId); return false; }
    catch { return true; }
  }, job.id);
  if (!approvalBlocked) throw new Error("Fixture without real readback became FinalApproved");
});

const variantData: Array<{ userData: string; status: string }> = [];
for (const [name, sql] of [["revoked", "UPDATE b01_product_e2e_authorization SET status='Revoked',revoked_at='2000-01-01'"],
  ["expired", "UPDATE b01_product_e2e_authorization SET expires_at='2000-01-01T00:00:00.000Z'"]] as const) {
  const variantStage = join(root, `${name}-staging.db`);
  copyFileSync(isolatedDb, variantStage);
  const fixtureDb = openDatabase(variantStage, migrations);
  fixtureDb.db.exec(sql); fixtureDb.db.close();
  variantData.push({ userData: isolatedData(name, variantStage), status: name === "revoked" ? "Revoked" : "Expired" });
}
for (const variant of variantData) await launch(variant.userData, async (page) => {
  const result = await page.evaluate((input) => window.publisherAPI.b01.eligibility(input),
    { accountId: account.id, articleId: article.id, imageAssetId: image.id });
  if (result.eligible || result.status !== variant.status) throw new Error(`${variant.status} authorization not blocked`);
});

const finalStage = join(root, "final-readback.db");
copyFileSync(isolatedDb, finalStage);
const finalDb = openDatabase(finalStage, migrations);
if (finalDb.repository.getB01Authorization()?.status !== "Prepared" || finalDb.repository.getSubmissionIntentByJob(job.id))
  throw new Error("Isolated fixture phase changed unexpectedly");
finalDb.db.close();
const productionAfter = existsSync(productionDb) ? { size: statSync(productionDb).size, mtimeMs: statSync(productionDb).mtimeMs } : null;
if (JSON.stringify(productionBefore) !== JSON.stringify(productionAfter)) throw new Error("Production database metadata changed");
console.log("B01_R2_INSTALLED_SMOKE=PASS main-grant/ui-selection/one-job/prepared-no-intent/restart/revoked/expired/diagnostic-block; real-platform=NO; final-submit=0; production-db-unchanged=YES");
