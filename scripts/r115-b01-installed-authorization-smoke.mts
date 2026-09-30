import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import Database from "better-sqlite3";
import { openDatabase } from "@publisher/db";

const base = join(process.cwd(), "output", "b01-candidate-authorization-smoke", String(Date.now()));
const executablePath = join(process.cwd(), "output", "b01-candidate-install-isolated", "Geo Media Publisher.exe");
const productionDb = join(process.env.APPDATA ?? "", "codex-media-publisher", "production-data", "publisher.db");
const productionMtime = existsSync(productionDb) ? statSync(productionDb).mtimeMs : null;
if (!existsSync(executablePath)) throw new Error("Installed Candidate is missing");
mkdirSync(base, { recursive: true });

const stagingDb = join(base, "staging.db");
if (existsSync(stagingDb)) throw new Error("Refusing to reuse a previous B01 authorization fixture");
const opened = openDatabase(stagingDb, join(process.cwd(), "packages", "db", "migrations"));
const repository = opened.repository;
repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
repository.setSetting("contentReviewMode", "Off");
const brand = repository.createBrand({ name: "B01 isolated smoke", companyName: "B01 isolated smoke" });
const account = repository.createAccount({ platformKey: "douyin", name: "B01 isolated account" });
const otherAccount = repository.createAccount({ platformKey: "douyin", name: "B01 wrong account" });
repository.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "isolated-fixture", browserSessionIdHash: "isolated-fixture" });
const article = repository.createArticle({ brandId: brand.id, title: "B01 isolated article", body: "B01 isolated body", summary: "", tags: [],
  seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
  generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "b01-isolated-smoke-content", qualityStatus: "passed",
  qualityWarnings: [], source: "production" });
const otherArticle = repository.createArticle({ brandId: brand.id, title: "B01 wrong article", body: "B01 wrong body", summary: "", tags: [],
  seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
  generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "b01-isolated-wrong-content", qualityStatus: "passed",
  qualityWarnings: [], source: "production" });
if (!article || !otherArticle) throw new Error("Isolated Articles were not created");
const wrongArticleId = otherArticle.id;
const imagePath = join(base, "fixture.png");
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7h8AAAAASUVORK5CYII=", "base64");
writeFileSync(imagePath, bytes);
const image = repository.createImageAsset({ brandId: brand.id, name: "B01 isolated image", filePath: imagePath,
  originalFileName: "fixture.png", mimeType: "image/png", size: bytes.length });
const imageSha256 = createHash("sha256").update(bytes).digest("hex");
repository.createB01Authorization({ platformKey: "douyin", accountId: account.id, articleId: article.id,
  imageAssetId: image.id, imageSha256, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
opened.db.close();

const revokedDb = join(base, "revoked.db");
const expiredDb = join(base, "expired.db");
copyFileSync(stagingDb, revokedDb);
copyFileSync(stagingDb, expiredDb);
for (const [path, sql] of [
  [revokedDb, "UPDATE b01_product_e2e_authorization SET status='Revoked', revoked_at=datetime('now')"],
  [expiredDb, "UPDATE b01_product_e2e_authorization SET expires_at='2000-01-01T00:00:00.000Z'"]
] as const) {
  const db = new Database(path);
  db.exec(sql);
  db.close();
}

const target = { accountId: account.id, articleId: article.id, imageAssetId: image.id };
function installFixture(name: string, source: string): string {
  const userData = join(base, name, "b01-isolated-user-data");
  const dataDir = join(userData, "production-data");
  mkdirSync(dataDir, { recursive: true });
  copyFileSync(source, join(dataDir, "publisher.db"));
  return userData;
}

async function inspect(userData: string, expectedStatus: string, expectedEligible: boolean, checkWrongBindings: boolean): Promise<void> {
  const app = await electron.launch({ executablePath, env: { ...process.env, GMP_B01_ISOLATED_USER_DATA_DIR: userData,
    PUBLISHER_DATA_MODE: "production", ELECTRON_RENDERER_URL: "", DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED: "false" }, timeout: 30_000 });
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.getByRole("heading", { name: "今天的内容运营" }).waitFor({ timeout: 30_000 });
    const exact = await page.evaluate(async (input) => window.publisherAPI.b01.eligibility(input), target);
    if (exact.status !== expectedStatus || exact.eligible !== expectedEligible)
      throw new Error(`Installed B01 status mismatch: ${JSON.stringify(exact)}`);
    if (checkWrongBindings) {
      const wrongAccount = await page.evaluate(async (input) => window.publisherAPI.b01.eligibility(input), { ...target, accountId: otherAccount.id });
      const wrongArticle = await page.evaluate(async (input) => window.publisherAPI.b01.eligibility(input), { ...target, articleId: wrongArticleId });
      const wrongImage = await page.evaluate(async (input) => window.publisherAPI.b01.eligibility(input), { ...target, imageAssetId: wrongArticleId });
      if (wrongAccount.eligible || wrongArticle.eligible || wrongImage.eligible) throw new Error("Installed B01 accepted a wrong binding");
      writeFileSync(imagePath, "mutated isolated image bytes");
      const changedImage = await page.evaluate(async (input) => window.publisherAPI.b01.eligibility(input), target);
      if (changedImage.eligible) throw new Error("Installed B01 accepted a changed image hash");
      writeFileSync(imagePath, bytes);
      await page.locator(".sidebar .nav-item").filter({ hasText: "发布中心" }).click();
      await page.getByRole("button", { name: "选择文章发布" }).click();
      await page.locator(".v11-publish-drawer select").first().selectOption(target.articleId);
      await page.getByRole("button", { name: "手动选择" }).click();
      await page.getByRole("button", { name: "B01 isolated image" }).click();
      const douyin = page.locator(".v11-channel-list .check-row").filter({ hasText: "抖音" }).first();
      if (!await douyin.locator("input[type=checkbox]").isDisabled())
        throw new Error("UI enabled B01 without an app-owned verified remote identity");
    }
  } finally { await app.close(); }
}

const createdData = installFixture("created", stagingDb);
await inspect(createdData, "Created", true, true);
await inspect(createdData, "Created", true, false);
await inspect(installFixture("revoked", revokedDb), "Revoked", false, false);
await inspect(installFixture("expired", expiredDb), "Expired", false, false);
if (productionMtime !== (existsSync(productionDb) ? statSync(productionDb).mtimeMs : null))
  throw new Error("Production database changed during isolated authorization smoke");
console.log("B01_INSTALLED_AUTHORIZATION_SMOKE=PASS created/wrong-binding/image-hash/restart/revoked/expired; remote identity remains unavailable; no platform access or final submit");
