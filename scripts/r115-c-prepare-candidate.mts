import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../packages/db/src";
import { freezeOfficialApiSelection } from "../apps/desktop/src/main/official-api-selection";
import { defaultOfficialApiSettings } from "../apps/desktop/src/renderer/official-api-publish-ui";
import type { OfficialApiContentSettings } from "../apps/desktop/src/shared/official-api";
import { OFFICIAL_API_ACCEPTANCE_MARKER } from "../apps/desktop/src/main/official-api-candidate";

// Closed-app copy only. Never open the normal production DB through host Node.
const privateRoot = process.env.R115C_PRIVATE_COPY_DIR;
const fixturePath = process.env.R115C_LOCAL_FIXTURES;
assert.ok(privateRoot && isAbsolute(privateRoot));
const privateRelative = relative(process.cwd(), privateRoot);
assert.ok(isAbsolute(privateRelative) || privateRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`), "business DB copy must remain outside repository");
assert.ok(fixturePath && isAbsolute(fixturePath));
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  marker: string; articles: Array<{ articleId: string; environment: "staging" | "production"; kind: "article" | "case" }>;
  assets: Array<{ assetId: string }>; connections: Array<{ accountId: string; environment: "staging" | "production" }>;
};
assert.equal(fixtures.marker, "GEO-R115C-20261001");
assert.equal(fixtures.articles.length, 3); assert.equal(fixtures.assets.length, 3);
mkdirSync(privateRoot, { recursive: true });
const copiedDb = join(privateRoot, "candidate-migration-copy.db");
assert.ok(!existsSync(copiedDb), "use a fresh private copy directory");
const sourceDb = join(process.env.APPDATA!, "codex-media-publisher", "production-data", "publisher.db");
for (const suffix of ["", "-wal", "-shm"]) if (existsSync(sourceDb + suffix)) copyFileSync(sourceDb + suffix, copiedDb + suffix);
const { db, repository } = openDatabase(copiedDb, join(process.cwd(), "packages/db/migrations"));
try {
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM official_api_operations").get() as { n: number }).n, 0);
  const assets = fixtures.assets.map(value => repository.getImageAsset(value.assetId)!);
  assert.ok(assets.every(Boolean));
  const selected = fixtures.articles.map(fixture => {
    const account = fixtures.connections.find(value => value.environment === fixture.environment)!;
    assert.ok(account);
    const article = repository.getArticle(fixture.articleId)!;
    assert.ok(article && article.title.startsWith("[系统验收] GEO-R115C-20261001"));
    const keyId = fixture.environment === "production" ? "production-admin" : fixture.kind === "case" ? "geo-r115c-case-20261001" : "geo-r115c-article-20261001";
    const settings: OfficialApiContentSettings = { ...defaultOfficialApiSettings(article), kind: fixture.kind,
      summary: "原创系统验收内容，用于验证康一官网 OfficialAPI 的媒体、版本、发布及恢复流程。验收结束后将清理。",
      category: "系统验收", keywords: ["系统验收", "OfficialAPI"],
      slug: `geo-r115c-20261001-${fixture.environment}-${fixture.kind}`, coverAssetId: assets[0]!.id,
      bodyImageAssetIds: assets.slice(1).map(value => value.id), galleryAssetIds: fixture.kind === "case" ? assets.slice(1).map(value => value.id) : [],
      ...(fixture.kind === "case" ? { location: "系统验收场景（非真实客户项目）", detailIntro: "此案例仅用于系统功能验收，不代表真实客户、项目或服务成果。", serviceFocus: ["系统媒体流程验收", "原始内容映射验收"] } : {}) };
    const prepared = freezeOfficialApiSelection(repository, article.id, { accountId: account.accountId, siteId: "kangyi", environment: fixture.environment, keyId }, settings);
    return { grant: { ...prepared.scope, articleId: article.id, kind: fixture.kind, contentBindingId: prepared.contentBindingId,
      ...(fixture.environment === "staging" ? { acceptanceRunId: randomUUID() } : {}) }, settings,
      sourceHash: prepared.sourceHash, slug: prepared.slug, imageCount: prepared.images.length };
  });
  const output = resolve("output/r115-c-execution-20260930"); mkdirSync(join(output, "candidate-resources"), { recursive: true });
  assert.ok(!existsSync(join(output, "candidate-selection-plan.json")), "candidate bindings are immutable once generated");
  writeFileSync(join(output, "candidate-selection-plan.json"), JSON.stringify(selected, null, 2));
  writeFileSync(join(output, "candidate-resources", OFFICIAL_API_ACCEPTANCE_MARKER), JSON.stringify({ purpose: "R1.15-C-OFFICIALAPI-ACCEPTANCE", version: 1,
    expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60_000).toISOString(), selections: selected.map(value => value.grant) }, null, 2));
  process.stdout.write(JSON.stringify({ candidateSelections: selected.length, productionQuota: 1, stagingKinds: ["article", "case"], migrationIntegrity: "PASS", productionDbOpenedByHostNode: false, remoteWrites: 0 }) + "\n");
} finally { db.close(); }
