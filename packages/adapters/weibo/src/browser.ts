import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import type { AccountContext, AccountProfile, LoginStatus, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import type { AutomationPrepareResult, BrowserPublishAttemptContext, BrowserPublishReconciliationInput, BrowserPublishReconciliationResult } from "@publisher/adapters-core";
import type { Locator, Page } from "playwright-core";

export function classifyWeiboCreatorSession(url: string, text: string, creatorId: string | null, composeCount: number): LoginStatus {
  let location: URL; try { location = new URL(url); } catch { return "unknown"; }
  if (location.protocol !== "https:" || !["weibo.com", "www.weibo.com"].includes(location.hostname) || location.username || location.password) return "needs_user_action";
  if (/登录微博|扫码登录|安全验证|人机验证|滑块验证/u.test(text) || /login|passport|captcha|security/iu.test(location.pathname)) return "needs_user_action";
  if (!creatorId || !/^[1-9]\d{5,}$/u.test(creatorId)) return "needs_user_action";
  return composeCount === 1 && /我的主页|个人主页|退出登录|发微博/u.test(text) ? "logged_in" : "unknown";
}
export function parseWeiboPostUrl(value: string, creatorId: string): { externalId: string; publishedUrl: string } | null {
  try {
    const url = new URL(value), match = url.pathname.match(/^\/(\d{6,})\/([a-z0-9]{5,})\/?$/iu);
    if (url.protocol !== "https:" || !["weibo.com", "www.weibo.com"].includes(url.hostname) || url.username || url.password || !match || match[1] !== creatorId) return null;
    return { externalId: match[2]!, publishedUrl: `https://weibo.com/${creatorId}/${match[2]}` };
  } catch { return null; }
}
const composedText = (article: PublishArticleInput): string => `${article.title.trim()}\n${article.body.trim()}`;
const normalize = (text: string) => text.replace(/\s+/gu, "").trim();
async function composeScope(editor: Locator): Promise<Locator> {
  let scope = editor.locator("xpath=..");
  for (let i = 0; i < 8 && await scope.getByRole("button", { name: /^(发布|发送)$/u }).count() !== 1; i++) scope = scope.locator("xpath=..");
  if (await scope.getByRole("button", { name: /^(发布|发送)$/u }).count() !== 1) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "微博编辑器发布控件不唯一，未提交");
  return scope;
}
async function previewFingerprints(scope: Locator): Promise<string[]> {
  const sources = await scope.locator("img").evaluateAll(elements => elements.filter(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0).map(element => (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src));
  return sources.map(source => createHash("sha256").update(source).digest("hex"));
}
export function assertWeiboImageBinding(paths: readonly string[], hashes: readonly string[]): void {
  let current: string[];
  try { current = paths.map(path => createHash("sha256").update(readFileSync(path)).digest("hex")); }
  catch { throw new BrowserAutomationError("CONTENT_REJECTED", "微博原配图已不可读取，未提交"); }
  if (JSON.stringify(current) !== JSON.stringify(hashes)) throw new BrowserAutomationError("CONTENT_REJECTED", "微博原配图已改变，未提交");
}
async function composeCandidates(page: Page): Promise<Locator[]> {
  const candidates = page.locator('textarea, [contenteditable="true"]'), found: Locator[] = [];
  for (let i = 0; i < await candidates.count(); i++) {
    const candidate = candidates.nth(i), hint = `${await candidate.getAttribute("placeholder")} ${await candidate.getAttribute("aria-label")}`;
    if (await candidate.isVisible() && await candidate.isEditable() && !/搜索|评论|comment|search/iu.test(hint)) found.push(candidate);
  }
  return found;
}
async function readIdentity(page: Page): Promise<{ creatorId: string | null; text: string }> {
  const identity = await page.locator("a[href]").evaluateAll(anchors => {
    const ids = new Set<string>();
    for (const element of anchors) {
      const anchor = element as HTMLAnchorElement, label = `${anchor.innerText} ${anchor.getAttribute("aria-label") ?? ""}`.trim();
      if (!/^(?:我的主页|个人主页)$/u.test(label)) continue;
      const url = new URL(anchor.href), match = url.pathname.match(/^\/u\/(\d{6,})\/?$/u) ?? url.pathname.match(/^\/(\d{6,})\/?$/u);
      if (url.protocol === "https:" && ["weibo.com", "www.weibo.com"].includes(url.hostname) && match) ids.add(match[1]!);
    }
    return ids.size === 1 ? [...ids][0]! : null;
  });
  return { creatorId: identity, text: await page.locator("body").innerText() };
}

const definition: BrowserPlatformDefinition = {
  platformKey: "weibo",
  displayName: "新浪微博",
  category: "内容/社交",
  officialWebsite: "https://weibo.com/",
  developerPortal: "https://open.weibo.com/",
  backendUrl: "https://weibo.com/",
  officialSources: ["https://weibo.com/", "https://open.weibo.com/"],
  version: "1.1.9-r115e",
  researchStatus: "partial",
  blockingReason: "Owner 需登录应用所属微博会话；历史普通动态合同已迁入专属 Adapter 并加固身份、内容回读和一次提交边界。当前真实编辑器未验收，正式发布仍关闭。",
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: false, markdown: false, richText: false, maxTitleLength: 200, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false, contentTransport: "ARTICLE_BROWSER", browserManagementReconciliation: true }
};

export class WeiboBrowserAdapter extends BrowserAutomationAdapter {
  private readonly prepared = new Map<string, { article: PublishArticleInput; creatorId: string; images: string[]; previews: string[]; text: string }>();
  private readonly submitted = new Set<string>();
  private readonly submittedAt = new Map<string, number>();
  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }
  protected override keepConnectionSessionOpenAfterCompletion(): boolean { return true; }
  protected override async inspectSessionPage(_ctx: AccountContext, page: Page): Promise<LoginStatus> {
    const identity = await readIdentity(page);
    return classifyWeiboCreatorSession(page.url(), identity.text, identity.creatorId, (await composeCandidates(page)).length);
  }
  protected override async inspectConnectionPage(ctx: AccountContext, page: Page): Promise<LoginStatus> { return this.inspectSessionPage(ctx, page); }
  async inspectOwnedCreatorReadiness(ctx: AccountContext): Promise<{ identityVerified: boolean; creatorId: string | null; status: LoginStatus }> {
    const active = await this.activeCanonicalPage(ctx);
    if (!active) return { identityVerified: false, creatorId: null, status: "needs_user_action" };
    const identity = await readIdentity(active.page), status = await this.inspectSessionPage(ctx, active.page);
    return { identityVerified: status === "logged_in", creatorId: identity.creatorId, status };
  }
  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const active = await this.activeCanonicalPage(ctx);
    if (!active) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "请由 Owner 完成微博官方登录");
    const identity = await readIdentity(active.page);
    if (await this.inspectSessionPage(ctx, active.page) !== "logged_in" || !identity.creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "微博真实身份尚未确认");
    return { accountId: identity.creatorId, accountName: `微博账号 ${identity.creatorId}`, authorizationStatus: "Authorized" };
  }
  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("；"));
    const opened = await this.openBackendPage(ctx), identity = await readIdentity(opened.page), candidates = await composeCandidates(opened.page);
    if (classifyWeiboCreatorSession(opened.page.url(), identity.text, identity.creatorId, candidates.length) !== "logged_in" || !identity.creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "微博需要 Owner 登录，遇验证请在官方页面正常完成");
    if (typeof ctx.settings.expectedCreatorId !== "string" || ctx.settings.expectedCreatorId !== identity.creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "微博当前身份与任务绑定账号不一致");
    const editor = candidates[0]!, text = composedText(article), imagePaths = article.images ?? (article.coverPath ? [article.coverPath] : []);
    await editor.fill(text);
    if (normalize(await editor.evaluate(element => element instanceof HTMLTextAreaElement ? element.value : (element as HTMLElement).innerText)) !== normalize(text)) throw new BrowserAutomationError("CONTENT_REJECTED", "微博正文回读不一致，未提交");
    const scope = await composeScope(editor);
    const images = imagePaths.map(path => createHash("sha256").update(readFileSync(path)).digest("hex"));
    if (imagePaths.length) {
      const upload = scope.locator('input[type="file"]');
      if (await upload.count() !== 1) throw new BrowserAutomationError("UPLOAD_FAILED", "微博图片上传控件无法确认");
      const before = await scope.locator("img").count();
      await upload.setInputFiles(imagePaths);
      await scope.locator("img").nth(before + imagePaths.length - 1).waitFor({ state: "visible", timeout: 10000 });
      const loaded = await scope.locator("img").evaluateAll(elements => elements.filter(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0).length);
      if (loaded < before + imagePaths.length) throw new BrowserAutomationError("UPLOAD_FAILED", "微博图片上传完成状态无法确认");
    }
    this.prepared.set(`${ctx.accountId}:${article.articleId}`, { article, creatorId: identity.creatorId, images, previews: await previewFingerprints(scope), text });
    return { prepared: true, requiresUserAction: true, message: "微博内容已准备，等待单独确认；未点击发布。", sessionIdHash: opened.session.sessionIdHash, backendUrl: opened.page.url(), editorOpenedAt: new Date().toISOString(), titleFilled: true, bodyFilled: true, response: { adapter: this.platformKey, contentTransport: "ARTICLE_BROWSER", expectedCreatorId: identity.creatorId, titleFilled: true, bodyFilled: true, imageUploaded: imagePaths.length > 0, uploadedImageCount: imagePaths.length, imageHashes: images, localSubmitCount: 0 } };
  }
  async prepareFinalSubmit(ctx: AccountContext, article: PublishArticleInput) {
    const active = await this.activeCanonicalPage(ctx), prepared = this.prepared.get(`${ctx.accountId}:${article.articleId}`);
    if (!active || !prepared || prepared.text !== composedText(article)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "微博准备状态已改变，请核对原任务，禁止创建替代提交");
    const identity = await readIdentity(active.page), candidates = await composeCandidates(active.page);
    if (classifyWeiboCreatorSession(active.page.url(), identity.text, identity.creatorId, candidates.length) !== "logged_in" || identity.creatorId !== prepared.creatorId || ctx.settings.expectedCreatorId !== prepared.creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "微博任务绑定身份已改变，未提交");
    const editor = candidates[0]!;
    if (normalize(await editor.evaluate(element => element instanceof HTMLTextAreaElement ? element.value : (element as HTMLElement).innerText)) !== normalize(prepared.text)) throw new BrowserAutomationError("CONTENT_REJECTED", "微博编辑器内容已改变，未提交");
    const scope = await composeScope(editor);
    assertWeiboImageBinding(article.images ?? (article.coverPath ? [article.coverPath] : []), prepared.images);
    if (JSON.stringify(await previewFingerprints(scope)) !== JSON.stringify(prepared.previews)) throw new BrowserAutomationError("CONTENT_REJECTED", "微博编辑器配图已改变，未提交");
    const button = scope.getByRole("button", { name: /^(发布|发送)$/u });
    if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "微博发布按钮暂时无法确认，未提交");
    return { response: { identityVerified: true, titleReadback: true, bodyReadback: true }, button };
  }
  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    if (!attempt.markSubmissionSideEffect || !attempt.submissionIntentId || this.submitted.has(attempt.submissionIntentId)) throw new BrowserAutomationError("RECONCILIATION_UNCERTAIN", "微博提交边界缺失或已使用，请勿重复发布");
    const state = await this.prepareFinalSubmit(ctx, article);
    attempt.markSubmissionSideEffect(); this.submitted.add(attempt.submissionIntentId);
    this.submittedAt.set(attempt.submissionIntentId, Date.now());
    await state.button.click();
    return this.collectPublishResult(ctx, article, attempt);
  }
  async collectPublishResult(ctx: AccountContext, article: PublishArticleInput, attempt?: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeCanonicalPage(ctx), prepared = this.prepared.get(`${ctx.accountId}:${article.articleId}`);
    if (!active || !prepared) throw new BrowserAutomationError("RECONCILIATION_UNCERTAIN", "微博结果无法确认，请勿再次提交");
    const boundaryAt = attempt ? this.submittedAt.get(attempt.submissionIntentId) : undefined;
    const rows = await active.page.locator("a[href]").evaluateAll(anchors => anchors.map(element => ({ href: (element as HTMLAnchorElement).href, text: element.closest("article")?.textContent ?? element.parentElement?.textContent ?? "", datetime: element.closest("article")?.querySelector("time[datetime]")?.getAttribute("datetime") ?? "" })));
    const matches = new Map<string, { externalId: string; publishedUrl: string }>();
    for (const row of rows) {
      const post = parseWeiboPostUrl(row.href, prepared.creatorId), remoteTime = Date.parse(row.datetime);
      if (post && boundaryAt !== undefined && Number.isFinite(remoteTime) && remoteTime >= boundaryAt && remoteTime <= Date.now() + 60000 && normalize(row.text).includes(normalize(prepared.text))) matches.set(post.externalId, post);
    }
    if (matches.size !== 1) throw new BrowserAutomationError("RECONCILIATION_UNCERTAIN", "微博远端结果暂时无法确认，请勿再次发布");
    const post = [...matches.values()][0]!;
    return { success: true, status: "publishing", ...post, response: { adapter: this.platformKey, submissionAccepted: true, exactAccountMatch: true, bodyMatch: true, readOnly: true, verificationPending: true } };
  }
  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const expected = String(ctx.settings.expectedCreatorId ?? ""), post = result.publishedUrl ? parseWeiboPostUrl(result.publishedUrl, expected) : null;
    const active = await this.activeCanonicalPage(ctx);
    if (!active || !post || post.externalId !== result.externalId) return { status: "publishing", response: { readOnly: true, verified: false } };
    const response = await active.page.goto(post.publishedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const urlMatch = parseWeiboPostUrl(active.page.url(), expected)?.externalId === result.externalId, text = await active.page.locator("body").innerText();
    const titleMatch = normalize(text).includes(normalize(article.title)), bodyMatch = normalize(text).includes(normalize(article.body)), urlReachable = response?.status() === 200 && urlMatch;
    return { status: urlReachable && titleMatch && bodyMatch ? "published" : "publishing", ...post, response: { readOnly: true, urlReachable, titleMatch, bodyMatch } };
  }
  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    const expected = input.expectedCreatorId ?? String(ctx.settings.expectedCreatorId ?? ""), post = input.expectedPublishedUrl ? parseWeiboPostUrl(input.expectedPublishedUrl, expected) : null;
    if (!post || post.externalId !== input.expectedExternalId || input.finalSubmitCount !== 1) return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { readOnly: true, noSecondSubmit: true }, message: "微博缺少原提交的可信 ID/URL，保持结果待确认；禁止重发。" };
    const active = await this.activeCanonicalPage(ctx);
    if (!active) return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { readOnly: true }, message: "微博原账号所属会话未激活；保持结果待确认。" };
    const response = await active.page.goto(post.publishedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const text = await active.page.locator("body").innerText();
    if (response?.status() !== 200 || parseWeiboPostUrl(active.page.url(), expected)?.externalId !== post.externalId || !normalize(text).includes(normalize(input.title)) || /扫码登录|人机验证|安全验证/u.test(text)) return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { readOnly: true }, message: "微博公开结果无法确认；保持原提交待确认，禁止重发。" };
    return { status: "FOUND_PUBLISHED", remoteState: "PUBLISHED", ...post, titleMatch: false, accountMatch: true, timeWindowMatch: false, response: { readOnly: true, matchedBy: "REMOTE_ID", exactAuthorUrlMatch: true, verificationPending: true }, message: "原提交 ID/URL 已匹配；仍须独立读取公开正文验证。" };
  }
}

