import type { AccountContext, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import type { BrowserPublishAttemptContext, BrowserPublishReconciliationInput, BrowserPublishReconciliationResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import type { AutomationPrepareResult } from "@publisher/adapters-core";
import type { Locator, Page } from "playwright-core";
import { assertZhihuReadback, discoverZhihuEditor, readZhihuEditorValue } from "./editor-discovery";

const ZHIHU_IMAGE_INPUT_SELECTOR = 'input[type="file"][accept*="image"], input[type="file"][accept*=".jpg"], input[type="file"][accept*=".jpeg"], input[type="file"][accept*=".png"], input[type="file"][accept*=".webp"]';
const ZHIHU_DIRECT_EDITOR_IMAGE_INPUT_SELECTOR = '.InputLike.PostEditor.EditorSnapshotWrapper input[type="file"][accept*="image/webp"][accept*="image/jpeg"][accept*="image/png"]';
const ZHIHU_EDITOR_IMAGE_SELECTOR = '.DraftEditor-root img, .public-DraftEditor-content img, [role="textbox"][contenteditable="true"] img';
const ZHIHU_EDITOR_UPLOAD_BUSY_SELECTOR = '.DraftEditor-root [aria-busy="true"], .public-DraftEditor-content [aria-busy="true"], [role="textbox"][contenteditable="true"] [aria-busy="true"], .DraftEditor-root [class*="uploading" i], .public-DraftEditor-content [class*="uploading" i], .DraftEditor-root progress, .public-DraftEditor-content progress';
const ZHIHU_EDITOR_URL = "https://zhuanlan.zhihu.com/write";
const ZHIHU_CONTENTS_URL = "https://www.zhihu.com/creator/manage/contents";
const ZHIHU_PUBLISHED_URL = /^https:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)(?:[/?#]|$)/iu;

const definition: BrowserPlatformDefinition = {
  platformKey: "zhihu",
  displayName: "知乎",
  category: "图文/问答",
  officialWebsite: "https://www.zhihu.com/",
  developerPortal: "https://open.zhihu.com/",
  backendUrl: "https://www.zhihu.com/creator",
  officialSources: ["https://www.zhihu.com/", "https://open.zhihu.com/"],
  version: "1.1.6",
  researchStatus: "partial",
  blockingReason: "首阶段完成用户自有浏览器 Session、创作中心打开和发布任务准备；不会绕过知乎验证码、风控或最终发布确认。",
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false }
};

export class ZhihuBrowserAdapter extends BrowserAutomationAdapter {
  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }

  private async uploadFirstImage(page: Page, imagePath: string): Promise<{ imageCountBefore: number; imageCountAfter: number }> {
    const editorImages = page.locator(ZHIHU_EDITOR_IMAGE_SELECTOR);
    const imageCountBefore = await editorImages.count();
    const editorSourcesBefore = await editorImages.evaluateAll((images) => images.map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src));
    let uploadMechanism = "not_started";
    let clickedTool = "not_found";

    try {
      // The page can contain unrelated cover and image-library inputs. The
      // image MIME input owned by the PostEditor snapshot wrapper is the
      // rich-text editor's direct upload path.
      const editor = page.locator('.DraftEditor-root [contenteditable="true"], .public-DraftEditor-content[contenteditable="true"], [role="textbox"][contenteditable="true"]').first();
      await editor.focus();
      await editor.press("Control+End");
      clickedTool = "post_editor_direct_image_input";
      const uploadInput = page.locator(ZHIHU_DIRECT_EDITOR_IMAGE_INPUT_SELECTOR).first();
      await uploadInput.waitFor({ state: "attached", timeout: 10_000 });
      uploadMechanism = "post_editor_snapshot_direct_image_input";
      await uploadInput.setInputFiles(imagePath);
      await page.waitForFunction(
        ({ selector, busySelector, baseline, baselineSources }) => {
          const images = [...document.querySelectorAll<HTMLImageElement>(selector)];
          if (images.length <= baseline) return false;
          const remainingSourceCounts = new Map<string, number>();
          for (const source of baselineSources) remainingSourceCounts.set(source, (remainingSourceCounts.get(source) ?? 0) + 1);
          const imageLoaded = images.some((image) => {
            const source = image.currentSrc || image.src;
            const remaining = remainingSourceCounts.get(source) ?? 0;
            if (remaining > 0) {
              remainingSourceCounts.set(source, remaining - 1);
              return false;
            }
            const style = window.getComputedStyle(image);
            const bounds = image.getBoundingClientRect();
            return /^https:\/\//iu.test(source)
              && image.complete
              && image.naturalWidth > 0
              && style.display !== "none"
              && style.visibility !== "hidden"
              && bounds.width > 0
              && bounds.height > 0;
          });
          const uploadStillBusy = [...document.querySelectorAll<HTMLElement>(busySelector)].some((element) => {
            const style = window.getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
          });
          return imageLoaded && !uploadStillBusy;
        },
        { selector: ZHIHU_EDITOR_IMAGE_SELECTOR, busySelector: ZHIHU_EDITOR_UPLOAD_BUSY_SELECTOR, baseline: imageCountBefore, baselineSources: editorSourcesBefore },
        { timeout: 60_000 }
      );
      await page.waitForTimeout(1_500);
      const imageCountAfter = await editorImages.count();
      if (imageCountAfter <= imageCountBefore) throw new BrowserAutomationError("UPLOAD_FAILED", "知乎编辑器未出现新增图片，未声明图片上传成功");
      return { imageCountBefore, imageCountAfter };
    } catch (error) {
      if (error instanceof BrowserAutomationError && error.code === "UPLOAD_FAILED") throw error;
      const evidence = await page.evaluate(({ inputSelector, imageSelector, busySelector }) => {
        const visible = (element: Element): boolean => {
          const target = element as HTMLElement;
          const style = window.getComputedStyle(target);
          const bounds = target.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
        };
        const compactClass = (element: Element | null): string => element instanceof HTMLElement ? String(element.className || "").slice(0, 160) : "";
        return {
          fileInputs: [...document.querySelectorAll<HTMLInputElement>(inputSelector)].map((input) => ({ accept: input.accept, className: compactClass(input), parentClass: compactClass(input.parentElement), visible: visible(input) })),
          editorImages: document.querySelectorAll(imageSelector).length,
          pageImages: [...document.images].slice(-8).map((image) => ({ className: compactClass(image), parentClass: compactClass(image.parentElement), ancestorClasses: Array.from({ length: 8 }, (_, depth) => { let ancestor: Element | null = image; for (let index = 0; index <= depth; index += 1) ancestor = ancestor?.parentElement ?? null; return compactClass(ancestor); }).filter(Boolean), sourceKind: (image.currentSrc || image.src).split(":", 1)[0] || "empty", loaded: image.complete && image.naturalWidth > 0, visible: visible(image) })),
          busyIndicators: document.querySelectorAll(busySelector).length,
          toolCandidates: [...document.querySelectorAll<HTMLElement>('button, [role="button"], [aria-label], [title], [data-tooltip]')].filter((tool) => /图片/u.test(`${tool.getAttribute("aria-label") ?? ""} ${tool.getAttribute("title") ?? ""} ${tool.getAttribute("data-tooltip") ?? ""} ${tool.innerText}`)).slice(0, 12).map((tool) => ({ tag: tool.tagName, label: tool.getAttribute("aria-label") || tool.getAttribute("title") || tool.getAttribute("data-tooltip") || tool.innerText.trim().slice(0, 40), className: compactClass(tool), visible: visible(tool) })),
          editors: [...document.querySelectorAll<HTMLElement>('[contenteditable="true"]')].slice(0, 6).map((editor) => ({ className: compactClass(editor), role: editor.getAttribute("role"), visible: visible(editor), children: [...editor.children].slice(0, 12).map((child) => `${child.tagName}.${compactClass(child)}`) })),
          uploadMessages: (document.body.innerText || "").split(/\r?\n/u).map((line) => line.trim()).filter((line) => /上传|图片|格式|大小|失败|网络/iu.test(line)).slice(0, 12)
        };
      }, { inputSelector: ZHIHU_IMAGE_INPUT_SELECTOR, imageSelector: ZHIHU_EDITOR_IMAGE_SELECTOR, busySelector: ZHIHU_EDITOR_UPLOAD_BUSY_SELECTOR }).catch((diagnosticError: unknown) => ({ fileInputs: [], editorImages: -1, pageImages: [], busyIndicators: -1, toolCandidates: [], editors: [], uploadMessages: [], diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }));
      const diagnostic = JSON.stringify({ uploadMechanism, clickedTool, ...evidence }).slice(0, 3_000);
      throw new BrowserAutomationError("UPLOAD_FAILED", `知乎图片上传未完成或未取得编辑器 DOM 证据，已停止操作（高级诊断：${diagnostic}）`);
    }
  }

  private async preparePublishStrict(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join(", "));
    const editorUrl = ZHIHU_EDITOR_URL;
    const opened = await this.openBackendPage(ctx, editorUrl);
    const editorOpenedAt = new Date().toISOString();
    const pageText = await opened.page.locator("body").innerText().catch(() => "");
    if (/captcha|security|upgrade|\u9a8c\u8bc1\u7801|\u4eba\u673a|\u98ce\u63a7/iu.test(pageText)) {
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Zhihu requested normal account verification; no bypass was attempted");
    }
    const title = await discoverZhihuEditor(opened.page, "title");
    const body = await discoverZhihuEditor(opened.page, "body");
    await title.locator.waitFor({ state: "visible", timeout: 10_000 });
    await body.locator.waitFor({ state: "visible", timeout: 10_000 });
    await title.locator.fill(article.title);
    assertZhihuReadback("title", article.title, await readZhihuEditorValue(title, "title"));
    await body.locator.fill(article.body);
    assertZhihuReadback("body", article.body, await readZhihuEditorValue(body, "body"));

    const events = ["EDITOR_OPEN_PASSED", "TITLE_FILLED", "BODY_FILLED"];
    const imagePath = article.images?.[0]?.trim() ?? "";
    let imageEvidence: { imageCountBefore: number; imageCountAfter: number } | null = null;
    if (imagePath) {
      events.push("IMAGE_UPLOAD_STARTED");
      imageEvidence = await this.uploadFirstImage(opened.page, imagePath);
      events.push("IMAGE_UPLOAD_PASSED");
    }
    return {
      prepared: true,
      requiresUserAction: true,
      message: "Zhihu editor was opened and title/body passed strict DOM readback; stopped before final submit.",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: editorUrl,
      editorOpenedAt,
      titleFilled: true,
      bodyFilled: true,
      response: {
        adapter: this.platformKey,
        stage: "editor_prepared",
        automationType: this.automationType,
        browserExecutionMode: opened.session.executionMode,
        headless: opened.session.headless,
        events,
        editorEvidence: { title: title.evidence, body: body.evidence },
        ...(imageEvidence ? {
          ...(() => { const evidence = imageEvidence; return {
          imageUploaded: true,
          imageUploadEvidence: "editor_image_count_increased_with_new_loaded_https_image_and_no_upload_progress",
          imageCountBefore: evidence.imageCountBefore,
          imageCountAfter: evidence.imageCountAfter
          }; })()
        } : {}),
        finalSubmit: "user_action_required"
      }
    };
  }

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    return this.preparePublishStrict(ctx, article);
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("；"));
    const editorUrl = ZHIHU_EDITOR_URL;
    const opened = await this.openBackendPage(ctx, editorUrl);
    const editorOpenedAt = new Date().toISOString();
    const pageText = await opened.page.locator("body").innerText().catch(() => "");
    if (/客户端.{0,12}(升级|更新)|版本过低|upgrade.{0,12}client/iu.test(pageText)) {
      throw new BrowserAutomationError("PLATFORM_CHANGED", "知乎当前页面提示客户端需升级；请升级系统浏览器或改用已更新的 Chrome 后重试");
    }
    const title = opened.page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"], input[aria-label*="标题"]').first();
    try {
      await title.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      throw new BrowserAutomationError("PLATFORM_CHANGED", "知乎文章编辑器标题输入框在限定时间内未出现，已停止操作");
    }
    await title.fill(article.title);
    const titleValue = (await title.inputValue()).trim();
    if (titleValue !== article.title.trim()) throw new BrowserAutomationError("CONTENT_REJECTED", "知乎标题输入后校验不一致，已停止操作");

    const body = opened.page.locator('.DraftEditor-root [contenteditable="true"], .public-DraftEditor-content[contenteditable="true"], [role="textbox"][contenteditable="true"]').first();
    try {
      await body.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      throw new BrowserAutomationError("PLATFORM_CHANGED", "知乎文章编辑器正文输入区在限定时间内未出现，已停止操作");
    }
    await body.fill(article.body);
    const bodyValue = (await body.innerText()).trim();
    if (!bodyValue.includes(article.body.trim())) throw new BrowserAutomationError("CONTENT_REJECTED", "知乎正文输入后校验不一致，已停止操作");

    const events = ["EDITOR_OPEN_PASSED", "TITLE_FILLED", "BODY_FILLED"];
    const imagePath = article.images?.[0]?.trim() ?? "";
    let imageEvidence: { imageCountBefore: number; imageCountAfter: number } | null = null;
    if (imagePath) {
      events.push("IMAGE_UPLOAD_STARTED");
      imageEvidence = await this.uploadFirstImage(opened.page, imagePath);
      events.push("IMAGE_UPLOAD_PASSED");
    }

    return {
      prepared: true,
      requiresUserAction: true,
      message: "知乎编辑器已打开，标题和正文已通过实际输入校验；系统已停止在最终发布按钮之前。",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: editorUrl,
      editorOpenedAt,
      titleFilled: true,
      bodyFilled: true,
      response: {
        adapter: this.platformKey,
        stage: "editor_prepared",
        automationType: this.automationType,
        browserExecutionMode: opened.session.executionMode,
        headless: opened.session.headless,
        events,
        ...(imageEvidence ? {
          imageUploaded: true,
          imageUploadEvidence: "editor_image_count_increased_with_new_loaded_https_image_and_no_upload_progress",
          imageCountBefore: imageEvidence!.imageCountBefore,
          imageCountAfter: imageEvidence!.imageCountAfter
        } : {}),
        finalSubmit: "user_action_required"
      }
    };
  }

  async prepareFinalSubmit(ctx: AccountContext, article: PublishArticleInput): Promise<{ response: Record<string, unknown> }> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Zhihu final-submit inspection requires the prepared browser session");
    const { page } = active;
    if (!ZHIHU_EDITOR_URL.startsWith(page.url().split("?", 1)[0])) throw new BrowserAutomationError("PLATFORM_CHANGED", "Zhihu is no longer on the verified article editor page");
    const pageText = await page.locator("body").innerText().catch(() => "");
    if (/captcha|security|\u9a8c\u8bc1\u7801|\u5b89\u5168\u9a8c\u8bc1|\u4eba\u673a|\u98ce\u63a7/iu.test(pageText)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Zhihu requested normal account verification; no bypass was attempted");
    const title = await discoverZhihuEditor(page, "title");
    const body = await discoverZhihuEditor(page, "body");
    assertZhihuReadback("title", article.title, await readZhihuEditorValue(title, "title"));
    assertZhihuReadback("body", article.body, await readZhihuEditorValue(body, "body"));
    const finalSubmitControl = await this.inspectFinalSubmitControl(page);
    return {
      response: {
        adapter: this.platformKey,
        stage: "final_submit_preflight",
        titleReadback: true,
        bodyReadback: true,
        editorEvidence: { title: title.evidence, body: body.evidence },
        finalSubmitControl: finalSubmitControl.evidence,
        finalSubmit: "user_action_required",
        finalSubmitClickCount: 0
      }
    };
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "知乎 L5 最终提交需要保留已完成标题、正文和图片校验的可见编辑器 Session");
    const { page } = active;
    if (!ZHIHU_EDITOR_URL.startsWith(page.url().split("?", 1)[0])) throw new BrowserAutomationError("PLATFORM_CHANGED", "知乎当前页面已离开已校验的文章编辑器，未执行最终提交");
    const pageText = await page.locator("body").innerText().catch(() => "");
    if (/captcha|security|验证码|安全验证|人机|风控/iu.test(pageText)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "知乎页面要求账号所有者完成正常安全验证；系统未尝试绕过验证");

    const title = page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"], input[aria-label*="标题"]').first();
    const body = page.locator('.DraftEditor-root [contenteditable="true"], .public-DraftEditor-content[contenteditable="true"], [role="textbox"][contenteditable="true"]').first();
    const titleValue = (await title.inputValue().catch(() => "")).trim();
    const bodyValue = (await body.innerText().catch(() => "")).trim();
    if (titleValue !== article.title.trim() || !bodyValue.includes(article.body.trim())) throw new BrowserAutomationError("CONTENT_REJECTED", "知乎最终提交前的标题或正文回读与已校验内容不一致，未执行最终提交");

    const strictTitle = await discoverZhihuEditor(page, "title");
    const strictBody = await discoverZhihuEditor(page, "body");
    assertZhihuReadback("title", article.title, await readZhihuEditorValue(strictTitle, "title"));
    assertZhihuReadback("body", article.body, await readZhihuEditorValue(strictBody, "body"));
    const submitButton = await this.findFinalSubmitButton(page);
    attempt.markSubmissionSideEffect?.();
    await submitButton.click();
    try {
      if (!ZHIHU_PUBLISHED_URL.test(page.url())) await page.waitForURL(ZHIHU_PUBLISHED_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (error) {
      const currentUrl = page.url();
      if (!ZHIHU_PUBLISHED_URL.test(currentUrl)) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `知乎最终提交动作已执行，但提交结果无法可靠确认（${error instanceof Error ? error.message : "导航超时"}）`);
    }
    const publishedUrl = page.url().split("#", 1)[0];
    const externalId = this.externalIdFromUrl(publishedUrl);
    if (!externalId) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "知乎最终提交动作已执行，但页面未返回可验证的文章 External ID");
    return {
      success: true,
      status: "published",
      externalId,
      publishedUrl,
      response: { adapter: this.platformKey, stage: "final_submitted", finalSubmitCount: 1, submissionIntentId: attempt.submissionIntentId, browserSessionIdHash: active.session.sessionIdHash, titleMatch: true, bodyMatch: true }
    };
  }

  async collectPublishResult(ctx: AccountContext, _article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "知乎最终提交后已没有可读取结果的 Browser Session");
    const publishedUrl = active.page.url().split("#", 1)[0];
    const externalId = this.externalIdFromUrl(publishedUrl);
    if (!externalId) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "知乎最终提交后未取得可验证的文章 URL");
    return { success: true, status: "published", externalId, publishedUrl, response: { adapter: this.platformKey, stage: "result_collected", submissionIntentId: attempt.submissionIntentId, browserSessionIdHash: active.session.sessionIdHash } };
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const externalId = result.externalId?.trim() ?? "";
    const publishedUrl = result.publishedUrl?.trim() ?? "";
    if (!externalId || !ZHIHU_PUBLISHED_URL.test(publishedUrl)) return { status: "failed", externalId: externalId || undefined, publishedUrl: publishedUrl || undefined, response: { titleMatch: false, urlReachable: false }, errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", errorMessage: "知乎发布结果缺少可验证 External ID 或 URL" };
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "failed", externalId, publishedUrl, response: { titleMatch: false, urlReachable: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "知乎发布结果验证需要可见 Browser Session" };
    try {
      await active.page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const heading = (await active.page.locator("h1").first().innerText().catch(() => "")).trim();
      const pageText = await active.page.locator("body").innerText().catch(() => "");
      const titleMatch = heading === article.title.trim() || (heading.length === 0 && pageText.includes(article.title.trim()));
      const urlReachable = ZHIHU_PUBLISHED_URL.test(active.page.url());
      if (!urlReachable || !titleMatch) return { status: "failed", externalId, publishedUrl: active.page.url(), response: { titleMatch, urlReachable, heading }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "知乎文章 URL 可导航，但标题回读或最终 URL 校验未通过" };
      return { status: "published", externalId, publishedUrl: active.page.url(), response: { titleMatch: true, urlReachable: true, heading, accountMatch: "authenticated_session" } };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { titleMatch: false, urlReachable: false }, errorCode: "NETWORK_ERROR", errorMessage: error instanceof Error ? error.message : "知乎文章 URL 不可访问" };
    }
  }

  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    const opened = await this.openBackendPage(ctx, ZHIHU_CONTENTS_URL);
    type PublishedCandidate = { href: string; text: string; context: string };
    type DraftCandidate = { context: string; hrefs: string[]; className: string };
    type ContentsSnapshot = { pageUrl: string; pageText: string; publishedCandidates: PublishedCandidate[]; draftCandidates: DraftCandidate[]; draftNavigationHref: string | null; articleNavigationHref: string | null; hasDraftSection: boolean };
    const collectSnapshot = async (): Promise<ContentsSnapshot> => await opened.page.evaluate(({ expectedTitle }) => {
      const publishedCandidates: Array<{ href: string; text: string; context: string }> = [];
      const publishedAnchors = document.querySelectorAll('a[href*="/p/"]');
      for (let index = 0; index < publishedAnchors.length; index += 1) {
        const anchor = publishedAnchors[index] as HTMLAnchorElement;
        const target = anchor as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || bounds.width <= 0 || bounds.height <= 0) continue;
        let row: Element = anchor;
        let context = "";
        for (let depth = 0; depth < 8; depth += 1) {
          context = (row instanceof HTMLElement ? row.innerText : row.textContent ?? "").trim();
          if (context.includes(expectedTitle) && context.length <= 1_600 && (/编辑|删除|草稿|发布|分钟前|刚刚|今天|昨天|\d{4}[年/-]/u.test(context) || depth >= 3)) break;
          if (!row.parentElement) break;
          row = row.parentElement;
        }
        const text = (anchor.innerText || anchor.textContent || "").trim();
        if (`${text}\n${context}`.includes(expectedTitle)) publishedCandidates.push({ href: anchor.href, text, context });
      }
      const draftCandidates: Array<{ context: string; hrefs: string[]; className: string }> = [];
      const titleNodes = document.querySelectorAll("body *");
      for (let index = 0; index < titleNodes.length && draftCandidates.length < 12; index += 1) {
        const element = titleNodes[index] as HTMLElement;
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const elementText = (element.innerText || element.textContent || "").trim();
        if (style.display === "none" || style.visibility === "hidden" || bounds.width <= 0 || bounds.height <= 0 || !elementText.includes(expectedTitle)) continue;
        let row: Element = element;
        let context = elementText;
        for (let depth = 0; depth < 8; depth += 1) {
          context = (row instanceof HTMLElement ? row.innerText : row.textContent ?? "").trim();
          if (context.includes(expectedTitle) && context.length <= 1_600 && (/编辑|删除|草稿|分钟前|刚刚|今天|昨天/u.test(context) || depth >= 3)) break;
          if (!row.parentElement) break;
          row = row.parentElement;
        }
        if (!context.includes(expectedTitle)) continue;
        const hrefs: string[] = [];
        const rowAnchors = row.querySelectorAll("a[href]");
        for (let linkIndex = 0; linkIndex < rowAnchors.length; linkIndex += 1) hrefs.push((rowAnchors[linkIndex] as HTMLAnchorElement).href);
        draftCandidates.push({ context, hrefs, className: row instanceof HTMLElement ? String(row.className || "").slice(0, 200) : "" });
      }
      let draftNavigationHref: string | null = null;
      let articleNavigationHref: string | null = null;
      const navigationAnchors = document.querySelectorAll("a[href]");
      for (let index = 0; index < navigationAnchors.length; index += 1) {
        const anchor = navigationAnchors[index] as HTMLAnchorElement;
        const label = (anchor.innerText || anchor.textContent || "").trim();
        if (!draftNavigationHref && /草稿/u.test(label)) draftNavigationHref = anchor.href;
        if (!articleNavigationHref && /^文章(?:\s|$)/u.test(label)) articleNavigationHref = anchor.href;
      }
      const pageText = (document.body?.innerText || document.body?.textContent || "").trim();
      return { pageUrl: location.href, pageText, publishedCandidates, draftCandidates, draftNavigationHref, articleNavigationHref, hasDraftSection: /草稿/u.test(pageText) };
    }, { expectedTitle: input.title });
    const visitReadOnly = async (href: string | null): Promise<ContentsSnapshot | null> => {
      if (!href) return null;
      try {
        const target = new URL(href, opened.page.url());
        if (target.origin !== new URL(opened.page.url()).origin) return null;
        if (target.href !== opened.page.url()) await opened.page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return await collectSnapshot();
      } catch { return null; }
    };
    let snapshot = await collectSnapshot();
    const initialPageUrl = snapshot.pageUrl;
    const initialPageText = snapshot.pageText;
    const draftNavigationHref = snapshot.draftNavigationHref;
    const articleNavigationHref = snapshot.articleNavigationHref;
    if (/captcha|security|验证码|安全验证|人机|风控/iu.test(`${snapshot.pageUrl}\n${snapshot.pageText}`)) {
      return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { pageUrl: snapshot.pageUrl, securityVerification: true }, message: "知乎内容列表触发了正常安全验证，未绕过且未重试" };
    }
    const articleSnapshot = await visitReadOnly(articleNavigationHref);
    if (articleSnapshot) snapshot = articleSnapshot;
    const candidates = snapshot.publishedCandidates;
    const windowStart = Date.parse(input.windowStart);
    const windowEnd = Date.parse(input.windowEnd);
    const candidateTimes = (context: string): number[] => {
      const values: number[] = [];
      const absolute = context.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/gu) ?? [];
      for (const value of absolute) { const parsed = Date.parse(value.replaceAll("/", "-")); if (Number.isFinite(parsed)) values.push(parsed); }
      const fullChinese = context.match(/\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?/gu) ?? [];
      for (const value of fullChinese) { const parsed = Date.parse(value.replace(/[年月]/gu, "-").replace("日", "")); if (Number.isFinite(parsed)) values.push(parsed); }
      const now = new Date();
      for (const match of context.matchAll(/(今天|昨天)\s*(\d{1,2}):(\d{2})/gu)) { const date = new Date(now); date.setDate(now.getDate() - (match[1] === "昨天" ? 1 : 0)); date.setHours(Number(match[2]), Number(match[3]), 0, 0); values.push(date.getTime()); }
      for (const match of context.matchAll(/(\d+)分钟前/gu)) values.push(Date.now() - Number(match[1]) * 60_000);
      if (/刚刚/u.test(context)) values.push(Date.now());
      return values;
    };
    const candidate = candidates.find((item) => {
      return candidateTimes(item.context).some((parsed) => (!Number.isFinite(windowStart) || parsed >= windowStart) && (!Number.isFinite(windowEnd) || parsed <= windowEnd));
    });
    if (candidate) {
      const externalId = this.externalIdFromUrl(candidate.href);
      if (externalId) return { status: "FOUND_PUBLISHED", externalId, publishedUrl: candidate.href.split("#", 1)[0], titleMatch: true, accountMatch: true, timeWindowMatch: true, response: { pageUrl: snapshot.pageUrl, matchedBy: "title_account_session_time_window", candidateContext: candidate.context.slice(0, 1_000) }, message: "知乎内容列表中找到标题、当前账号 Session 和时间窗口均匹配的真实文章" };
    }
    const titleCandidate = candidates[0];
    if (titleCandidate) return { status: "STILL_UNCERTAIN", titleMatch: true, accountMatch: true, timeWindowMatch: false, response: { pageUrl: snapshot.pageUrl, matchedBy: "title_only", candidateContext: titleCandidate.context.slice(0, 1_000) }, message: "知乎内容列表找到同名候选，但时间窗口无法可靠匹配" };
    const draftSnapshot = await visitReadOnly(draftNavigationHref);
    if (draftSnapshot) snapshot = draftSnapshot;
    const draftCandidate = snapshot.draftCandidates.find((candidate) => /编辑|删除|草稿|分钟前|刚刚|今天|昨天/u.test(candidate.context) && !candidate.hrefs.some((href) => this.externalIdFromUrl(href)));
    if (draftCandidate && snapshot.hasDraftSection) return { status: "CONFIRMED_NOT_PUBLISHED", titleMatch: true, accountMatch: true, timeWindowMatch: true, response: { pageUrl: snapshot.pageUrl, matchedBy: "exact_title_in_draft_section_without_published_url", draftContext: draftCandidate.context.slice(0, 1_000), articlePageChecked: initialPageText.slice(0, 1_000), initialPageUrl }, message: "知乎当前账号中精确标题仅出现在草稿区，文章页未找到匹配的已发布 URL" };
    return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: true, timeWindowMatch: false, response: { pageUrl: snapshot.pageUrl, matchedBy: "no_reliable_candidate", visibleTextSample: snapshot.pageText.slice(0, 1_000) }, message: "知乎内容列表未取得足够完整的标题、账号和时间窗口证据，保持 NeedsReconciliation" };
  }

  private externalIdFromUrl(url: string): string | null {
    const match = ZHIHU_PUBLISHED_URL.exec(url);
    return match?.[1] ?? null;
  }

  private async inspectFinalSubmitControl(page: Page): Promise<{ locator: Locator; evidence: { verified: boolean; enabled: boolean; label: string; selector: string; clickRequired: false } }> {
    const selector = 'button, [role="button"]';
    const candidates = page.locator(selector);
    const count = await candidates.count();
    const labels: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const isVisible = await candidate.isVisible().catch(() => false);
      const isEnabled = await candidate.isEnabled().catch(() => false);
      if (!isVisible) continue;
      const label = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`.trim();
      labels.push(label);
      if (isEnabled && /(?:publish|submit|\u53d1\u5e03|\u53d1\u8868|\u53d1\u5e03\u6587\u7ae0|鍙戝竷|鍙戣〃)/iu.test(label) && !/(?:save|draft|\u4fdd\u5b58|\u8349\u7a3f|淇濆瓨|鑽夌)/iu.test(label)) {
        return { locator: candidate, evidence: { verified: true, enabled: true, label, selector, clickRequired: false } };
      }
    }
    throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `Zhihu final-submit control was not verified; visible labels: ${labels.slice(0, 8).join(" | ")}`);
  }

  private async findFinalSubmitButton(page: Page): Promise<Locator> {
    const candidates = page.locator('button, [role="button"]');
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false)) || !(await candidate.isEnabled().catch(() => false))) continue;
      const label = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`.trim();
      if (/(^|\s)(发布|发表)(文章)?($|\s)/u.test(label) && !/保存|草稿/iu.test(label)) return candidate;
    }
    throw new BrowserAutomationError("PLATFORM_CHANGED", "知乎最终发布按钮未在已校验编辑器中出现，未执行点击");
  }
}
