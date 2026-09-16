import { app, safeStorage } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const dataDirectory = join(userDataPath, "production-data");
const accountId = "9b11ca84-5824-4ed8-aadb-fa204b39c249";
const platformKey = "bilibili";
const outputPath = join(process.cwd(), "output", "v126-bilibili-capability-check.json");
const screenshotPath = join(process.cwd(), "output", "v126-bilibili-capability-check.png");

app.setName("codex-media-publisher");
app.setPath("userData", userDataPath);
mkdirSync(join(process.cwd(), "output"), { recursive: true });

type ActiveSession = { page: Page };
type AdapterInternals = { activeSessions: Map<string, ActiveSession> };

async function main(): Promise<void> {
  await app.whenReady();
  const adapterRegistryModulePath = "../apps/desktop/src/main/adapter-registry.ts";
  const [{ openDatabase }, { SafeStorageCredentialStore }, { createFileLogger }, { createRuntimeAdapterRegistry }] = await Promise.all([
    import("@publisher/db"), import("@publisher/security"), import("@publisher/logger"), import(adapterRegistryModulePath)
  ]);
  const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  const registry = createRuntimeAdapterRegistry(credentials, false, logger);
  const repository = opened.repository;
  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), platformKey, accountId, browserMode: "VISIBLE", readOnly: true, finalSubmitCount: 0, clickCount: 0 };
  try {
    const adapter = registry.get(platformKey);
    const account = repository.listAccounts().find((item) => item.id === accountId && item.platformKey === platformKey);
    if (!account) throw new Error("B站测试账号不存在");
    const context = { accountId, accountName: account.name, platformKey, settings: { dryRun: false, manualConfirmationRequired: false, triggerSource: "OPEN_BACKEND", userActionId: `v126-${Date.now()}`, browserExecutionMode: "VISIBLE" }, secrets: {} };
    const login = await adapter.checkLogin(context);
    evidence.login = login;
    if (login !== "logged_in") throw new Error(`B站登录检查未通过：${login}`);
    const page = (adapter as unknown as AdapterInternals).activeSessions.get(`${platformKey}:${accountId}`)?.page;
    if (!page) throw new Error("B站未取得应用自建 Visible Browser Page");
    await page.goto("https://member.bilibili.com/platform/home", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({ text: (anchor.textContent ?? "").replace(/\s+/gu, " ").trim(), href: (anchor as HTMLAnchorElement).href })).filter((item) => item.text || /dynamic|article|upload|video|member|bilibili/iu.test(item.href)).slice(0, 120));
    const controls = await page.locator('button, [role="button"]').evaluateAll((items) => items.map((item) => ({ text: (item.textContent ?? "").replace(/\s+/gu, " ").trim(), aria: item.getAttribute("aria-label") ?? "", visible: Boolean((item as HTMLElement).offsetWidth || (item as HTMLElement).offsetHeight) })).filter((item) => item.visible && (item.text || item.aria)).slice(0, 120));
    const dynamicSignals = [...links.map((item) => item.text), ...controls.map((item) => `${item.text} ${item.aria}`)].filter((value) => /动态|图文|发布动态|文字动态|图片动态|post|dynamic/iu.test(value));
    const videoSignals = [...links.map((item) => item.text), ...controls.map((item) => `${item.text} ${item.aria}`)].filter((value) => /视频|投稿|视频投稿|video/iu.test(value));
    await page.goto("https://t.bilibili.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3_000);
    const dynamicScreenshotPath = join(process.cwd(), "output", "v126-bilibili-dynamic-capability-check.png");
    await page.screenshot({ path: dynamicScreenshotPath, fullPage: false });
    const dynamicBodyText = await page.locator("body").innerText().catch(() => "");
    const dynamicTextboxes = await page.locator('textarea, [contenteditable="true"], input[type="file"]').evaluateAll((items) => items.map((item) => ({ tag: item.tagName.toLowerCase(), placeholder: item.getAttribute("placeholder") ?? "", aria: item.getAttribute("aria-label") ?? "", visible: Boolean((item as HTMLElement).offsetWidth || (item as HTMLElement).offsetHeight) })));
    const dynamicControls = await page.locator('button, [role="button"], a').evaluateAll((items) => items.map((item) => ({ text: (item.textContent ?? "").replace(/\s+/gu, " ").trim(), aria: item.getAttribute("aria-label") ?? "", href: item instanceof HTMLAnchorElement ? item.href : "", visible: Boolean((item as HTMLElement).offsetWidth || (item as HTMLElement).offsetHeight) })).filter((item) => item.visible && (item.text || item.aria || item.href)).slice(0, 160));
    const visibleTextboxes = dynamicTextboxes.filter((item) => item.visible && item.tag !== "input").length;
    const visibleFileInputs = dynamicTextboxes.filter((item) => item.visible && item.tag === "input").length;
    const dynamicComposer = visibleTextboxes > 0 && visibleFileInputs > 0;
    evidence.page = { url: "https://member.bilibili.com/platform/home", title: await page.title(), bodyExcerpt: bodyText.slice(0, 6_000), dynamicSignals, videoSignals, links, controls, screenshotPath, dynamicPage: { url: page.url(), bodyExcerpt: dynamicBodyText.slice(0, 6_000), textboxes: dynamicTextboxes, controls: dynamicControls, dynamicComposer, screenshotPath: dynamicScreenshotPath } };
    evidence.result = dynamicComposer ? "DYNAMIC_CAPABILITY_PRESENT" : "VIDEO_ONLY_OR_DYNAMIC_NOT_EXPOSED";
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.log(`V126_FINAL=${JSON.stringify({ outputPath, login, result: evidence.result, dynamicSignals, videoSignals, dynamicComposer, screenshotPath, finalSubmitCount: 0 })}`);
  } catch (error) {
    evidence.error = { message: error instanceof Error ? error.message : String(error) };
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.error(`V126_ERROR=${JSON.stringify({ outputPath, message: evidence.error })}`);
    throw error;
  } finally {
    await Promise.allSettled(registry.list().map((item: unknown) => (item as { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.()).filter((promise: Promise<void> | undefined): promise is Promise<void> => Boolean(promise)));
    opened.db.close();
    app.quit();
  }
}

void main().catch(() => {
  if (!app.isReady()) app.quit();
});
