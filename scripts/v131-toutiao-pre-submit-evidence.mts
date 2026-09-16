import { app, safeStorage } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAutomationAdapter, type AutomationAdapter } from "@publisher/adapters-core";
import type { Frame, Locator, Page } from "playwright-core";

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const dataDirectory = join(userDataPath, "production-data");
const accountId = "3ffa4368-e8cd-4725-8658-846ad35b1980";
const outputPath = join(process.cwd(), "output", "v131-toutiao-pre-submit-evidence.json");
const screenshotPath = join(process.cwd(), "output", "v131-toutiao-pre-submit-page.png");

type JsonRecord = Record<string, unknown>;
type AdapterWithSessions = { activeSessions?: Map<string, { page: Page }> };

function redact(value: string): string {
  return value
    .replace(/(cookie|token|secret|authorization|access[_-]?key|refresh[_-]?token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]")
    .slice(0, 6_000);
}

app.setName("codex-media-publisher");
app.setPath("userData", userDataPath);
mkdirSync(join(process.cwd(), "output"), { recursive: true });

async function inspectPage(page: Page): Promise<JsonRecord> {
  await page.waitForTimeout(8_000);
  const frameEvidence: JsonRecord[] = [];
  for (const frame of page.frames()) {
    try {
      frameEvidence.push(await inspectFrame(frame));
    } catch (error) {
      frameEvidence.push({ url: frame.url(), inspectionError: error instanceof Error ? error.message : String(error) });
    }
  }
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return {
    url: page.url(),
    title: await page.title(),
    frameUrls: page.frames().map((frame) => frame.url()).slice(0, 40),
    rootOverlay: await inspectOverlay(page),
    frames: frameEvidence,
    screenshotPath
  };
}

async function inspectOverlay(document: { locator: (selector: string) => Locator }): Promise<JsonRecord> {
  const drawer = document.locator(".ai-assistant-drawer");
  const drawerCount = await drawer.count().catch(() => 0);
  const masks = document.locator(".byte-drawer-mask");
  const maskCount = await masks.count().catch(() => 0);
  const controls: JsonRecord[] = [];
  const drawerControls = drawer.locator("button, [role=button], a, [aria-label], [title], [class*=close], [class*=Close]");
  const controlCount = await drawerControls.count().catch(() => 0);
  for (let index = 0; index < Math.min(controlCount, 50); index += 1) {
    const control = drawerControls.nth(index);
    controls.push({
      text: (await control.innerText().catch(() => "")).replace(/\s+/gu, " ").trim().slice(0, 120),
      ariaLabel: await control.getAttribute("aria-label").catch(() => null),
      title: await control.getAttribute("title").catch(() => null),
      class: await control.getAttribute("class").catch(() => null),
      role: await control.getAttribute("role").catch(() => null),
      visible: await control.isVisible().catch(() => false),
      enabled: await control.isEnabled().catch(() => false)
    });
  }
  return { drawerCount, maskCount, maskVisible: maskCount > 0 ? await masks.first().isVisible().catch(() => false) : false, controls };
}

async function inspectFrame(frame: Frame): Promise<JsonRecord> {
  const controls: JsonRecord[] = [];
  const controlLocator = frame.locator("button, [role=button], a");
  const controlCount = await controlLocator.count().catch(() => 0);
  for (let index = 0; index < Math.min(controlCount, 160); index += 1) {
    const control = controlLocator.nth(index);
    if (!await control.isVisible().catch(() => false)) continue;
    const text = (await control.innerText().catch(() => "")).replace(/\s+/gu, " ").trim();
    const aria = (await control.getAttribute("aria-label"))?.trim() ?? "";
    const title = (await control.getAttribute("title"))?.trim() ?? "";
    const href = (await control.getAttribute("href"))?.trim() ?? "";
    if (!text && !aria && !title && !href) continue;
    controls.push({ tag: await control.getAttribute("role") ? "role=button" : "element", label: [text, aria, title].filter(Boolean).join(" "), href, disabled: (await control.getAttribute("aria-disabled")) === "true" || (await control.getAttribute("disabled")) !== null });
  }
  const fields: JsonRecord[] = [];
  const fieldLocator = frame.locator("input, textarea, select, [contenteditable=true]");
  const fieldCount = await fieldLocator.count().catch(() => 0);
  for (let index = 0; index < Math.min(fieldCount, 80); index += 1) {
    const field = fieldLocator.nth(index);
    if (!await field.isVisible().catch(() => false)) continue;
    fields.push({
      tag: await field.getAttribute("contenteditable") === "true" ? "contenteditable" : (await field.getAttribute("type")) === "file" ? "input[type=file]" : "field",
      type: await field.getAttribute("type") ?? "",
      label: [await field.getAttribute("aria-label"), await field.getAttribute("placeholder")].filter((value): value is string => Boolean(value)).join(" "),
      name: await field.getAttribute("name") ?? "",
      id: await field.getAttribute("id") ?? "",
      class: await field.getAttribute("class") ?? "",
      role: await field.getAttribute("role") ?? "",
      dataTestId: await field.getAttribute("data-testid") ?? "",
      required: (await field.getAttribute("required")) !== null || (await field.getAttribute("aria-required")) === "true",
      contenteditable: await field.getAttribute("contenteditable") ?? "",
      disabled: (await field.getAttribute("disabled")) !== null || (await field.getAttribute("aria-disabled")) === "true",
      readonly: (await field.getAttribute("readonly")) !== null,
      enabled: await field.isEnabled().catch(() => false)
    });
  }
  const titleSelectors = [
    'input[placeholder*="标题"], textarea[placeholder*="标题"], input[aria-label*="标题"], textarea[aria-label*="标题"]',
    'input[name*="title" i], textarea[name*="title" i], input[id*="title" i], textarea[id*="title" i]',
    'input[placeholder], textarea[placeholder]'
  ];
  const selectorEvidence = titleSelectors.map((selector) => ({
    selector,
    count: 0
  }));
  for (const item of selectorEvidence) item.count = await frame.locator(item.selector).count().catch(() => 0);
  const bodyText = await frame.locator("body").innerText().catch(() => "");
  const coverModeCandidates: JsonRecord[] = [];
  const coverModeLocator = frame.locator('text="单图"');
  const coverModeCount = await coverModeLocator.count().catch(() => 0);
  for (let index = 0; index < Math.min(coverModeCount, 20); index += 1) {
    const candidate = coverModeLocator.nth(index);
    const parent = candidate.locator("xpath=..");
    const grandparent = parent.locator("xpath=..");
    const ancestor = grandparent.locator("xpath=..");
    coverModeCandidates.push({
      text: await candidate.innerText().catch(() => ""),
      visible: await candidate.isVisible().catch(() => false),
      enabled: await candidate.isEnabled().catch(() => false),
      role: await candidate.getAttribute("role").catch(() => null),
      class: await candidate.getAttribute("class").catch(() => null),
      parentClass: await parent.getAttribute("class").catch(() => null),
      parentRole: await parent.getAttribute("role").catch(() => null),
      parentAriaChecked: await parent.getAttribute("aria-checked").catch(() => null),
      parentDataState: await parent.getAttribute("data-state").catch(() => null),
      grandparentClass: await grandparent.getAttribute("class").catch(() => null),
      grandparentRole: await grandparent.getAttribute("role").catch(() => null),
      grandparentAriaChecked: await grandparent.getAttribute("aria-checked").catch(() => null),
      grandparentDataState: await grandparent.getAttribute("data-state").catch(() => null),
      ancestorClass: await ancestor.getAttribute("class").catch(() => null),
      ancestorRole: await ancestor.getAttribute("role").catch(() => null),
      ancestorAriaChecked: await ancestor.getAttribute("aria-checked").catch(() => null)
    });
  }
  const coverClassCandidates: JsonRecord[] = [];
  const coverClassLocator = frame.locator('[class*="byte-radio"]');
  const coverClassCount = await coverClassLocator.count().catch(() => 0);
  for (let index = 0; index < Math.min(coverClassCount, 30); index += 1) {
    const candidate = coverClassLocator.nth(index);
    coverClassCandidates.push({
      class: await candidate.getAttribute("class").catch(() => null),
      text: (await candidate.innerText().catch(() => "")).replace(/\s+/gu, " ").trim().slice(0, 120),
      visible: await candidate.isVisible().catch(() => false),
      enabled: await candidate.isEnabled().catch(() => false),
      role: await candidate.getAttribute("role").catch(() => null),
      ariaChecked: await candidate.getAttribute("aria-checked").catch(() => null)
    });
  }
  const coverRadioCandidates: JsonRecord[] = [];
  const coverRadioLocator = frame.locator(".article-cover-radio-group .byte-radio");
  const coverRadioCount = await coverRadioLocator.count().catch(() => 0);
  for (let index = 0; index < Math.min(coverRadioCount, 10); index += 1) {
    const candidate = coverRadioLocator.nth(index);
    coverRadioCandidates.push({
      text: (await candidate.innerText().catch(() => "")).replace(/\s+/gu, " ").trim(),
      class: await candidate.getAttribute("class").catch(() => null),
      visible: await candidate.isVisible().catch(() => false),
      enabled: await candidate.isEnabled().catch(() => false),
      ariaChecked: await candidate.getAttribute("aria-checked").catch(() => null)
    });
  }
  const coverGroupAncestors: JsonRecord[] = [];
  let coverNode = frame.locator(".article-cover-radio-group");
  for (let level = 0; level < 5; level += 1) {
    coverGroupAncestors.push({
      level,
      class: await coverNode.getAttribute("class").catch(() => null),
      text: (await coverNode.innerText().catch(() => "")).replace(/\s+/gu, " ").trim().slice(0, 240),
      visible: await coverNode.isVisible().catch(() => false)
    });
    coverNode = coverNode.locator("xpath=..");
  }
  const coverRelatedNodes: JsonRecord[] = [];
  const coverRelatedLocator = frame.locator('[class*="cover"], [class*="Cover"], [class*="upload"], [class*="Upload"], [class*="image"], [class*="Image"]');
  const coverRelatedCount = await coverRelatedLocator.count().catch(() => 0);
  for (let index = 0; index < Math.min(coverRelatedCount, 120); index += 1) {
    const candidate = coverRelatedLocator.nth(index);
    const className = await candidate.getAttribute("class").catch(() => null);
    const text = (await candidate.innerText().catch(() => "")).replace(/\s+/gu, " ").trim().slice(0, 180);
    if (!await candidate.isVisible().catch(() => false) && !text) continue;
    coverRelatedNodes.push({ class: className, text, visible: await candidate.isVisible().catch(() => false), role: await candidate.getAttribute("role").catch(() => null) });
  }
  const drawerEvidence: JsonRecord[] = [];
  const drawerLocator = frame.locator(".ai-assistant-drawer");
  const drawerCount = await drawerLocator.count().catch(() => 0);
  for (let index = 0; index < Math.min(drawerCount, 5); index += 1) {
    const drawer = drawerLocator.nth(index);
    const drawerControls = drawer.locator("button, [role=button], a");
    const drawerControlCount = await drawerControls.count().catch(() => 0);
    const visibleControls: JsonRecord[] = [];
    for (let controlIndex = 0; controlIndex < Math.min(drawerControlCount, 40); controlIndex += 1) {
      const control = drawerControls.nth(controlIndex);
      if (!await control.isVisible().catch(() => false)) continue;
      visibleControls.push({
        text: (await control.innerText().catch(() => "")).replace(/\s+/gu, " ").trim().slice(0, 120),
        ariaLabel: await control.getAttribute("aria-label").catch(() => null),
        title: await control.getAttribute("title").catch(() => null),
        class: await control.getAttribute("class").catch(() => null),
        role: await control.getAttribute("role").catch(() => null),
        disabled: (await control.getAttribute("disabled").catch(() => null)) !== null || (await control.getAttribute("aria-disabled").catch(() => null)) === "true"
      });
    }
    drawerEvidence.push({
      visible: await drawer.isVisible().catch(() => false),
      class: await drawer.getAttribute("class").catch(() => null),
      text: (await drawer.innerText().catch(() => "")).replace(/\s+/gu, " ").trim().slice(0, 1_000),
      visibleControls
    });
  }
  const mask = frame.locator(".byte-drawer-mask");
  return { url: frame.url(), bodyTextExcerpt: redact(bodyText), bodyTextLength: bodyText.length, controls, fields, titleSelectorEvidence: selectorEvidence, coverModeCandidates, coverClassCandidates, coverRadioCandidates, coverGroupAncestors, coverRelatedNodes, fileInputCount: await frame.locator('input[type="file"]').count().catch(() => 0), drawerEvidence, drawerMaskVisible: await mask.isVisible().catch(() => false) };
}

async function main(): Promise<void> {
  await app.whenReady();
  const [{ openDatabase }, { SafeStorageCredentialStore }, { createFileLogger }, { createRuntimeAdapterRegistry }, { transparentSelfTestContent }] = await Promise.all([
    import("@publisher/db"),
    import("@publisher/security"),
    import("@publisher/logger"),
    import("../apps/desktop/src/main/adapter-registry"),
    import("../apps/desktop/src/main/platform-self-test")
  ]);
  const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  const registry = createRuntimeAdapterRegistry(credentials, false, logger);
  const evidence: JsonRecord = {
    startedAt: new Date().toISOString(),
    platformKey: "toutiao",
    contentKind: "article",
    platformAccountId: accountId,
    browserExecutionMode: "VISIBLE",
    finalSubmitClickCount: 0,
    finalSubmitAction: "FORBIDDEN",
    route: null,
    account: null,
    login: null,
    page: null,
    result: null
  };
  let adapter: AutomationAdapter | null = null;
  try {
    const selectedAdapter = registry.getForContent("toutiao", "article");
    if (!isAutomationAdapter(selectedAdapter)) throw new Error("Toutiao article route did not resolve to an automation adapter");
    adapter = selectedAdapter;
    const account = opened.repository.listAccounts().find((item) => item.id === accountId && item.platformKey === "toutiao");
    if (!account) throw new Error("Toutiao account not found");
    const articlePlatform = opened.repository.listPlatforms().find((item) => item.platformKey === "toutiao");
    evidence.route = {
      adapterClass: adapter.constructor.name,
      adapterPlatformKey: adapter.platformKey,
      integrationMode: adapter.manifest.integrationMode,
      supportsArticle: adapter.manifest.supportsArticle,
      supportsVideo: adapter.manifest.supportsVideo,
      videoAdapterStillOfficialApi: registry.getForContent("toutiao", "video").constructor.name === "ToutiaoAdapter",
      platform: articlePlatform ? { platformKey: articlePlatform.platformKey, integrationMode: articlePlatform.integrationMode } : null
    };
    evidence.account = {
      id: account.id,
      platformAccountId: account.platformAccountId ?? account.id,
      platformKey: account.platformKey,
      enabled: account.enabled,
      loginStatus: account.loginStatus,
      authorizationStatus: account.authorizationStatus,
      connectionMode: account.connectionMode,
      browserSessionIdPresent: Boolean(account.browserSessionId)
    };
    const userActionId = `v131-toutiao-${Date.now()}`;
    const context = {
      accountId: account.id,
      accountName: account.accountAlias || account.name,
      platformKey: "toutiao",
      settings: { triggerSource: "RUN_SELF_TEST", userActionId, browserExecutionMode: "VISIBLE" },
      secrets: {}
    } as const;
    const login = await adapter.checkLogin(context);
    evidence.login = login;
    const image = opened.repository.listImageAssets(undefined, true).find((item) => item.universal || [...item.usage, ...item.tags].some((label) => /^(测试|通用)$/u.test(label.trim()))) ?? null;
    const baseArticle = transparentSelfTestContent("toutiao", articlePlatform?.displayName ?? "toutiao");
    const article = image && adapter.getCapabilities().maxImageCount > 0 ? { ...baseArticle, images: [image.filePath] } : baseArticle;
    if (login !== "logged_in") throw new Error(`Toutiao login check failed: ${login}`);
    try {
      const prepared = await adapter.preparePublish(context, article);
      evidence.result = "PREPARED";
      evidence.prepared = prepared;
    } catch (error) {
      evidence.result = "FAILED_CLOSED";
      evidence.error = { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null, code: typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code ?? null : null };
    }
    const activePage = (adapter as unknown as AdapterWithSessions).activeSessions?.get(`toutiao:${account.id}`)?.page;
    if (activePage) evidence.page = await inspectPage(activePage);
  } catch (error) {
    evidence.result = "HARNESS_FAILED";
    evidence.error = { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (adapter) await (adapter as typeof adapter & { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.().catch(() => undefined);
    opened.db.close();
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    app.quit();
  }
}

void main().catch((error) => {
  console.error(`V131_ERROR=${error instanceof Error ? error.message : String(error)}`);
  app.quit();
});
