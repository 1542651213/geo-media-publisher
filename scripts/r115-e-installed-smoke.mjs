/* global window, document */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";

const executablePath = resolve(process.argv[2] ?? "output/r115-e-department-install/Geo Media Publisher.exe");
assert.ok(existsSync(executablePath));
const root = resolve("output/r115-e-execution-20261001", `installed-smoke-${Date.now()}`);
const userData = join(root, "b01-isolated-user-data"); mkdirSync(userData, { recursive: true });
const original = join(process.env.APPDATA ?? "", "codex-media-publisher", "production-data");
const hash = data => createHash("sha256").update(data).digest("hex");
const protectedBytes = () => Object.fromEntries(["publisher.db", "publisher.db-wal", "publisher.db-shm", "credentials.enc"].map(name => [name, existsSync(join(original, name)) ? hash(readFileSync(join(original, name))) : null]));
const before = protectedBytes();
let generationRequests = 0, modelRequests = 0, repairRequests = 0, unknownRequests = 0;
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") { modelRequests++; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: [{ id: "offline-fixture" }, { id: "manual-fixture" }] })); return; }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") { unknownRequests++; response.writeHead(404); response.end(); return; }
  assert.equal(request.headers.authorization, "Bearer non-production-local-fixture");
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(input.model, "offline-fixture"); assert.equal(input.stream, false);
  const prompt = input.messages[1].content;
  const repair = input.messages[0].content.includes("仅修复标题长度");
  let output;
  if (repair) { repairRequests++; output = { title: "示例企业流程说明" }; }
  else {
    generationRequests++;
    const platform = /平台：([a-z_]+)/u.exec(prompt)?.[1] ?? "weibo";
    output = { title: platform === "douyin" ? "甲".repeat(21) : "示例企业流程说明", body: `示例甲有限公司的流程资料。离线草稿${String.fromCharCode(0x7532 + generationRequests)}。` };
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise(resolvePort => server.listen(0, "127.0.0.1", resolvePort));
const port = server.address().port, baseUrl = `http://127.0.0.1:${port}/v1`;
const dialogSelection = new Function("electron", "path", "electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });");
const inspectMain = new Function("electron", "input", `
  const require = process.mainModule.require.bind(process.mainModule);
  const fs = require('node:fs'), path = require('node:path');
  const Database = require(path.join(electron.app.getAppPath(), 'node_modules/better-sqlite3'));
  const db = new Database(path.join(input.userData,'production-data','publisher.db'), { readonly:true });
  const counts = Object.fromEntries(['publish_jobs','publish_records','submission_intents','ai_generation_history','ai_local_drafts','articles','article_variants'].map(name => [name, db.prepare('SELECT COUNT(*) n FROM '+name).get().n]));
  const migrations = db.prepare('SELECT COUNT(*) n FROM migrations').get().n;
  const contextBound = db.prepare('SELECT context_version,context_json FROM ai_generation_inputs').all().every(row => row.context_version === 1 && JSON.parse(row.context_json).tone === '专业、克制、只引用资料');
  const integrity = db.pragma('integrity_check', {simple:true}), foreignKeys = db.pragma('foreign_key_check').length;
  const secretsAbsentFromSqlite = !fs.readFileSync(path.join(input.userData,'production-data','publisher.db')).includes(input.fixture);
  const encrypted = fs.readFileSync(path.join(input.userData,'production-data','credentials.enc'),'utf8');
  const credentialEncrypted = !encrypted.includes(input.fixture);
  db.close();
  return {counts,migrations,integrity,foreignKeys,contextBound,secretsAbsentFromSqlite,credentialEncrypted,electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules,packaged:electron.app.isPackaged};
`);
const nav = (page, name) => page.locator(".sidebar .nav-item").filter({ hasText: name }).click();
async function launch(run) {
  const app = await electron.launch({ executablePath, timeout: 30000, env: { ...process.env, GMP_B01_ISOLATED_USER_DATA_DIR: userData, TOUTIAO_READONLY_PREFLIGHT: "true", PUBLISHER_DATA_MODE: "production", ELECTRON_RENDERER_URL: "", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "false" } });
  try { const page = await app.firstWindow(); await page.getByRole("heading", { name: "今天的内容运营" }).waitFor(); try { await run(page, app); } catch (error) { await page.screenshot({ path: join(root, "failure.png"), fullPage: true }); throw error; } } finally { await app.close(); }
}
let brandId, sourceArticleId, inspection;
try {
  await launch(async (page, app) => {
    assert.equal(await page.evaluate(() => window.publisherAPI.settings.get().then(value => value.developerMode === true)), false);
    const brands = await page.evaluate(async () => [await window.publisherAPI.brands.create({ name: "示例甲品牌", companyName: "示例甲有限公司" }), await window.publisherAPI.brands.create({ name: "示例乙品牌", companyName: "示例乙有限公司" })]); brandId = brands[0].id;
    await page.reload(); await page.getByRole("heading", { name: "今天的内容运营" }).waitFor();
    for (const name of ["文章库", "图片库", "账号中心", "发布中心", "数据统计"]) { await nav(page, name); assert.deepEqual(await page.getByRole("button", { name: /Candidate|B01|首次上传后发现|自测|真实发布验收/u }).allTextContents(), [], `Ordinary route: ${name}`); }
    await nav(page, "AI 服务商"); await page.getByRole("heading", { name: "AI Provider Center", level: 2 }).waitFor();
    assert.equal(await page.getByLabel("AI 服务商").locator("option").count(), 5);
    await page.getByLabel("AI 服务商").selectOption("custom");
    await page.getByLabel("AI API 地址").fill(baseUrl); await page.getByLabel("AI 默认模型").fill("offline-fixture"); await page.getByLabel("AI API Key").fill("non-production-local-fixture");
    await page.getByRole("button", { name: "保存服务商", exact: true }).click(); await page.getByText("配置已保存；凭据由系统安全存储保管。").waitFor();
    assert.equal(await page.getByLabel("AI API Key").inputValue(), "");
    await page.getByRole("button", { name: "获取模型列表", exact: true }).click(); await page.getByText("模型列表已加载，也可手工填写模型 ID。").waitFor();
    assert.equal(await page.locator("#provider-models option").count(), 2);
    await page.getByRole("button", { name: "Test Connection", exact: true }).click(); await page.getByText("连接和模型列表已验证；生成能力以实际请求为准").waitFor();
    const profiles = await page.evaluate(() => window.publisherAPI.aiCenter.profiles()); assert.equal(profiles.length, 1); assert.equal("credentialRef" in profiles[0], false); assert.equal(profiles[0].configured, true);
    await page.screenshot({ path: join(root, "provider-center.png") });
    await page.getByRole("button", { name: "企业 AI 资料", exact: true }).click();
    await page.locator("fieldset section label").filter({ hasText: /^企业/u }).locator("select").selectOption(brandId);
    await page.waitForFunction(() => [...document.querySelectorAll("label")].find(label => label.textContent.startsWith("企业名称"))?.querySelector("input")?.value === "示例甲有限公司");
    await page.getByLabel("语气", { exact: true }).fill("专业、克制、只引用资料"); await page.getByRole("button", { name: "保存企业 AI 资料", exact: true }).click(); await page.getByText("当前企业 AI 资料已保存").waitFor();
    await page.getByRole("button", { name: "提示词模板", exact: true }).click(); await page.locator("fieldset section label").filter({ hasText: /^模板/u }).locator("select").selectOption("industry");
    await page.getByLabel("名称", { exact: true }).fill("行业科普（运营版）"); await page.getByRole("button", { name: "保存新版本", exact: true }).click(); await page.getByText("新模板版本已保存，历史生成记录仍指向原版本。").waitFor();
    await page.getByRole("button", { name: "AI Content Studio", exact: true }).click(); await page.getByLabel("AI 企业").selectOption(brandId);
    await page.getByLabel("AI 源稿").fill("示例甲有限公司的流程资料，仅用于本机离线草稿验收。");
    await page.getByRole("checkbox", { name: /^抖音/u }).uncheck(); await page.getByRole("checkbox", { name: /^微博/u }).check(); await page.getByLabel("生成模板").selectOption("industry@2");
    await page.getByRole("button", { name: "读取可选模型", exact: true }).click(); await page.getByText("可从模型列表选择，也可手工填写兼容的文本模型 ID。").waitFor();
    await page.getByRole("button", { name: "Generate 本地草稿", exact: true }).click(); await page.getByText("生成已结束；请逐平台校验、编辑并保存草稿。").waitFor();
    await page.getByRole("button", { name: "Validate 内容", exact: true }).click(); await page.getByText("确定性校验通过；仍需人工核对事实").waitFor();
    await page.getByRole("button", { name: "保存 Draft", exact: true }).click(); await page.getByText("已保存内容库草稿，未创建发布任务。").waitFor();
    sourceArticleId = (await page.evaluate(() => window.publisherAPI.articles.list()))[0].id;
    await nav(page, "文章库"); await page.getByRole("heading", { name: "管理可发布的文章" }).waitFor(); await page.locator(".v11-article-row").first().waitFor(); assert.ok((await page.locator(".v11-article-row").count()) >= 1);
    await nav(page, "内容生产"); await page.getByLabel("AI 企业").selectOption(brandId); await page.getByLabel("AI 源文章").selectOption(sourceArticleId); await page.getByLabel("生成模板").selectOption("industry@2");
    for (const checkbox of await page.locator("fieldset .check-row input[type=checkbox]").all()) await checkbox.check();
    await page.getByRole("button", { name: "Generate 本地草稿", exact: true }).click(); await page.getByText("生成已结束；请逐平台校验、编辑并保存草稿。").waitFor();
    for (const platform of ["douyin", "toutiao", "weibo", "sohu_media", "website", "cnblogs"]) {
      const body = page.getByLabel(`${platform} 草稿正文`); const title = page.getByLabel(`${platform} 草稿标题`); if (platform === "douyin") assert.ok((await title.inputValue()).length <= 20);
      const panel = body.locator("xpath=ancestor::section[1]");
      if (platform === "weibo") { await body.fill("示例乙有限公司的错误资料"); await panel.getByRole("button", { name: "Validate 内容", exact: true }).click(); await panel.getByText("出现其它企业名称").waitFor(); }
      await body.fill(`示例甲有限公司的流程资料。${platform} 人工编辑。`); await panel.getByRole("button", { name: "Validate 内容", exact: true }).click(); await panel.getByRole("button", { name: "保存 Draft", exact: true }).click(); await panel.getByRole("heading", { name: /已保存/u }).waitFor();
    }
    assert.equal(repairRequests, 1); assert.equal(generationRequests, 7);
    await page.screenshot({ path: join(root, "content-studio.png"), fullPage: true });
    const drafts = await page.evaluate(() => window.publisherAPI.articles.list()); assert.equal(drafts.length, 7);
    assert.equal((await page.evaluate(id => window.publisherAPI.articles.variants(id), sourceArticleId)).length, 6);
    await nav(page, "高级功能"); await app.evaluate(dialogSelection, join(root, "diagnostic.json")); await page.getByRole("button", { name: "导出脱敏 Diagnostic Bundle", exact: true }).click();
    for (let i = 0; !existsSync(join(root, "diagnostic.json")) && i < 40; i++) await new Promise(resolveWait => setTimeout(resolveWait, 100));
    const bundleText = readFileSync(join(root, "diagnostic.json"), "utf8"), bundle = JSON.parse(bundleText);
    for (const forbidden of ["non-production-local-fixture", "示例甲", baseUrl, root, "systemPrompt", "userPrompt"]) assert.equal(bundleText.includes(forbidden), false);
    assert.deepEqual(bundle.platforms.filter(row => row.ordinaryPublishEnabled).map(row => row.platform).sort(), ["douyin", "toutiao", "website"]); assert.ok(bundle.platforms.every(row => row.batchPublishEnabled === false));
    await page.getByLabel(/Developer \/ Diagnostics Mode/u).click(); await page.waitForFunction(() => window.publisherAPI.settings.get().then(value => value.developerMode === true));
    await page.locator("label.check-row input[type=checkbox]:checked").waitFor();
    assert.equal(await page.getByLabel(/Developer \/ Diagnostics Mode/u).isChecked(), true);
    const rejected = await page.evaluate(async () => { try { await window.publisherAPI.platformSelfTest.confirmPublish("isolated-fake"); return false; } catch { return true; } }); assert.equal(rejected, true);
    await page.getByLabel(/Developer \/ Diagnostics Mode/u).click(); await page.waitForFunction(() => window.publisherAPI.settings.get().then(value => value.developerMode === false));
    await page.locator("label.check-row input[type=checkbox]:not(:checked)").waitFor();
    inspection = await app.evaluate(inspectMain, { userData, fixture: "non-production-local-fixture" });
    assert.equal(inspection.contextBound, true);
    for (const name of ["publish_jobs", "publish_records", "submission_intents"]) assert.equal(inspection.counts[name], 0);
    assert.equal(inspection.counts.ai_generation_history, 7); assert.equal(inspection.migrations, readdirSync("packages/db/migrations").filter(name => name.endsWith(".sql")).length); assert.equal(inspection.integrity, "ok"); assert.equal(inspection.foreignKeys, 0); assert.equal(inspection.credentialEncrypted, true); assert.equal(inspection.secretsAbsentFromSqlite, true);
  });
  await launch(async page => {
    assert.equal(await page.evaluate(() => window.publisherAPI.settings.get().then(settings => settings.developerMode === true)), false);
    assert.equal((await page.evaluate(() => window.publisherAPI.aiCenter.profiles()))[0].configured, true);
    await nav(page, "内容生产"); await page.getByRole("button", { name: "生成历史", exact: true }).click();
    const rows = await page.evaluate(id => window.publisherAPI.aiCenter.history(id), brandId); assert.equal(rows.length, 7); assert.ok(rows.every(row => row.status === "Saved" && row.templateVersion === 2));
    assert.equal((await page.evaluate(() => window.publisherAPI.articles.list())).length, 7); assert.equal((await page.evaluate(id => window.publisherAPI.articles.variants(id), sourceArticleId)).length, 6);
    await page.screenshot({ path: join(root, "generation-history-restart.png"), fullPage: true });
  });
  assert.deepEqual(protectedBytes(), before); assert.equal(unknownRequests, 0);
  const result = { status: "PASS", packaged: inspection.packaged, electron: inspection.electron, node: inspection.node, abi: inspection.abi, providerChoices: 5, modelRequests, generationRequests, titleRepairRequests: repairRequests, localArticles: 7, sourceLinkedVariants: 6, historyRestart: "PASS", contextAndTemplateVersion: "PASS", foreignCompanyBlocked: true, writeOnlyCredential: true, encryptedCredential: inspection.credentialEncrypted, plaintextCredentialAbsentFromSqlite: inspection.secretsAbsentFromSqlite, developerDefaultOff: true, developerCannotFinalSubmit: true, diagnosticAllowlist: "PASS", protectedOriginalBytesUnchanged: true, externalGenerationRequests: 0, realPlatformPublishCount: 0, newFinalSubmitCount: 0, fixtureJobIntentRecordCount: 0 };
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2)); writeFileSync("output/r115-e-execution-20261001/installed-smoke-result.json", JSON.stringify({ ...result, evidenceDirectory: root }, null, 2)); console.log(JSON.stringify(result));
} finally { await new Promise(resolveClose => server.close(resolveClose)); }
