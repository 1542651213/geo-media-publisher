import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import type { BrowserSession, BrowserSessionManager } from "@publisher/adapters-core";
import type { Locator, Page } from "playwright-core";
import { AccountOperationMutex, XiaohongshuBrowserAdapter, classifyXiaohongshuLoginEvidence, classifyXiaohongshuPublishSettings, normalizeXiaohongshuEditorText, type XiaohongshuLoginEvidence } from "./browser";

const article: PublishArticleInput = {
  articleId: "article-xhs-1",
  title: "GMP 小红书图文能力验证 2026-08-27 12:34:56",
  body: "这是 Geo Media Publisher 小红书 BrowserAutomation 图文能力验证内容，仅用于验证账号、图片、标题、正文和发布控件，不执行最终发布。",
  summary: "",
  tags: [],
  images: ["C:/fixtures/xiaohongshu-test.png"]
};

type FixtureOptions = {
  accountId?: string | null;
  accountName?: string;
  accountLabelText?: string | null;
  profileHref?: string | null;
  pageUrl?: string;
  entryCount?: number;
  videoEntryCount?: number;
  titleCount?: number;
  bodyCount?: number;
  titleReadback?: string;
  bodyReadback?: string;
  imagePreviewCount?: number;
  imageLoading?: boolean;
  imageFailed?: boolean;
  requiredEmpty?: boolean;
  securityText?: string;
  settings?: Array<{ label: string; required: boolean; value: string }>;
  submitCount?: number;
  submitEnabled?: boolean;
  secondConfirmation?: boolean;
  loginPage?: boolean;
  pagePresentInContext?: boolean;
  operationPageInitialUrl?: string;
  entryNavigationEnabled?: boolean;
  publishEntryMode?: "direct-image" | "generic-publish";
  publishEntryCount?: number;
  publishEntryClickFails?: boolean;
  contentTypeEntryCount?: number;
  contentTypeSelectionEnabled?: boolean;
  contentTypeSelectionFails?: boolean;
  routeWaitTimeout?: boolean;
  fileInputCount?: number;
  intermediateAction?: boolean;
  editorScopedImageItemCount?: number;
  nativePickerOpenAfterUpload?: boolean;
  nativePickerCancelFails?: boolean;
  closedShadowFinalSubmit?: boolean;
};

interface Fixture {
  page: Page;
  manager: BrowserSessionManager;
  submitClick: ReturnType<typeof vi.fn>;
  inputSetFiles: ReturnType<typeof vi.fn>;
  entryClick: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  operationPageDebugIds: string[];
  operationContextDebugIds: string[];
  operationPages: Page[];
  calls: string[];
  session: BrowserSession;
  keyboardPress: ReturnType<typeof vi.fn>;
  nativePickerCancel: ReturnType<typeof vi.fn>;
  phaseSnapshot: () => Record<string, unknown>;
  postUploadSnapshot: () => Record<string, unknown>;
}

function installSharedConnectionLifecycle(fixture: Fixture): void {
  const managerState = (fixture.manager as unknown as {
    __fixtureState?: {
      session: BrowserSession;
      context: { pages: () => Page[] };
      createOperationPage: () => Page;
    };
  }).__fixtureState;
  if (!managerState) throw new Error("fixture state is missing");
  const active = new Map<string, BrowserSession>();
  const pending = new Set<string>();
  const runtimeStates = new Map<string, { state: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED"; contextDebugId: string | null; updatedAt: string; reason: string | null }>();
  const operationPages = new Map<string, Set<Page>>();
  const manager = fixture.manager as unknown as Record<string, unknown>;
  const identityKey = (identity: { platformKey: string; accountId: string }): string => `${identity.platformKey}:${identity.accountId}`;
  manager.getActiveSession = vi.fn((identity: { platformKey: string; accountId: string }) => active.get(identityKey(identity)) ?? null);
  manager.setActiveSession = vi.fn((identity: { platformKey: string; accountId: string }, session: BrowserSession) => { active.set(`${identity.platformKey}:${identity.accountId}`, session); });
  manager.clearActiveSession = vi.fn((identity: { platformKey: string; accountId: string }, session?: BrowserSession) => {
    const key = identityKey(identity);
    if (!session || active.get(key) === session) active.delete(key);
  });
  manager.markConnectionPending = vi.fn((identity: { platformKey: string; accountId: string }) => { pending.add(identityKey(identity)); });
  manager.isConnectionPending = vi.fn((identity: { platformKey: string; accountId: string }) => pending.has(identityKey(identity)));
  manager.clearConnectionPending = vi.fn((identity: { platformKey: string; accountId: string }) => { pending.delete(identityKey(identity)); });
  manager.requiresActiveContextForOperations = vi.fn((identity: { platformKey: string; accountId: string }) => identity.platformKey === "xiaohongshu");
  manager.retainsContextAfterPageClose = vi.fn((identity: { platformKey: string; accountId: string }) => identity.platformKey === "xiaohongshu");
  manager.openOperationPage = vi.fn(async (identity: { platformKey: string; accountId: string }) => {
    const key = identityKey(identity);
    const session = active.get(key) ?? managerState.session;
    active.set(key, session);
    const page = managerState.createOperationPage();
    const canonicalEvaluate = (session.page as unknown as { evaluate?: unknown }).evaluate;
    if (typeof canonicalEvaluate === "function") (page as unknown as { evaluate: unknown }).evaluate = canonicalEvaluate;
    const pages = operationPages.get(key) ?? new Set<Page>();
    pages.add(page);
    operationPages.set(key, pages);
    const pageDebugId = `operation-page-${fixture.operationPageDebugIds.length + 1}`;
    fixture.operationPageDebugIds.push(pageDebugId);
    fixture.operationContextDebugIds.push(session.contextDebugId ?? "unknown-context");
    return { session, page, pageDebugId };
  });
  manager.closeOperationPage = vi.fn(async (identity: { platformKey: string; accountId: string }, page: Page) => {
    const key = identityKey(identity);
    const session = active.get(key) ?? null;
    const ownedOperationPage = Boolean(session && operationPages.get(key)?.has(page));
    const retainedCanonicalPage = Boolean(session && identity.platformKey === "xiaohongshu" && session.page === page);
    if (!session || (!ownedOperationPage && !retainedCanonicalPage) || !managerState.context.pages().includes(page)) {
      throw new Error("Operation Page does not belong to the active session Context");
    }
    await (page as unknown as { close: () => Promise<void> }).close();
    if (ownedOperationPage) operationPages.get(key)?.delete(page);
  });
  manager.setRuntimeAuthState = vi.fn((identity: { platformKey: string; accountId: string }, state: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED", reason: string | null) => {
    const session = active.get(identityKey(identity)) ?? null;
    runtimeStates.set(identityKey(identity), { state, contextDebugId: session?.contextDebugId ?? null, updatedAt: new Date().toISOString(), reason });
  });
  manager.getRuntimeAuthState = vi.fn((identity: { platformKey: string; accountId: string }) => runtimeStates.get(identityKey(identity)) ?? {
    state: "UNVERIFIED",
    contextDebugId: null,
    updatedAt: new Date(0).toISOString(),
    reason: null
  });
}

function locator(overrides: Partial<Record<string, unknown>> = {}): Locator {
  return {
    count: vi.fn(async () => 0),
    first: vi.fn(function (this: Locator) { return this; }),
    nth: vi.fn(function (this: Locator) { return this; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => ""),
    textContent: vi.fn(async () => ""),
    inputValue: vi.fn(async () => ""),
    boundingBox: vi.fn(async () => ({ x: 10, y: 10, width: 120, height: 40 })),
    fill: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined),
    getAttribute: vi.fn(async () => null),
    locator: vi.fn(function (this: Locator) { return this; }),
    evaluateAll: vi.fn(async () => []),
    ...overrides
  } as unknown as Locator;
}

function setupPage(options: FixtureOptions = {}): Fixture {
  const calls: string[] = [];
  const creatorHomeUrl = options.pageUrl ?? "https://creator.xiaohongshu.com/";
  let currentUrl = options.loginPage ? "https://www.xiaohongshu.com/login" : creatorHomeUrl;
  let titleValue = "";
  let bodyValue = "";
  let imageUploaded = false;
  let intermediateActionVisible = options.intermediateAction === true;
  let contentTypeShown = false;
  let contextPages: Page[] = [];
  const pageContextRef: { value?: BrowserSession["context"] } = {};
  let setActivePageUrl: ((url: string) => void) | null = null;
  const operationPageDebugIds: string[] = [];
  const operationContextDebugIds: string[] = [];
  const operationPages: Page[] = [];
  const submitClick = vi.fn(async () => { calls.push("final-submit-click"); });
  const inputSetFiles = vi.fn(async () => {
    imageUploaded = true;
    if (options.nativePickerOpenAfterUpload) setActivePageUrl?.("https://creator.xiaohongshu.com/publish/publish?openFilePicker=true");
    calls.push("image-set-input-files");
  });
  const entryClick = vi.fn(async () => {
    if (options.publishEntryClickFails) throw new Error("publish entry click failed");
    const publishUrl = "https://creator.xiaohongshu.com/publish/publish";
    if (options.entryNavigationEnabled !== false) {
      setActivePageUrl?.(publishUrl);
      currentUrl = publishUrl;
    }
    calls.push("image-post-entry-click");
  });

  const profile = locator({
    count: vi.fn(async () => options.profileHref === null ? 0 : 1),
    innerText: vi.fn(async () => options.accountName ?? "XHS owner"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? options.profileHref ?? "https://www.xiaohongshu.com/user/profile/65abc123" : name === "aria-label" ? "个人主页" : null)
  });
  const nickname = locator({
    count: vi.fn(async () => options.profileHref === null ? 1 : 0),
    innerText: vi.fn(async () => options.accountName ?? "XHS owner"),
    getAttribute: vi.fn(async (name: string) => name === "aria-label" ? "账号昵称" : null)
  });
  const accountLabelParent = locator({
    innerText: vi.fn(async () => options.accountLabelText ?? ""),
    textContent: vi.fn(async () => options.accountLabelText ?? ""),
    getAttribute: vi.fn(async (name: string) => name === "class" ? "account-summary" : null),
    evaluate: vi.fn(async () => "DIV")
  });
  const accountLabel = locator({
    count: vi.fn(async () => options.accountLabelText ? 1 : 0),
    innerText: vi.fn(async () => options.accountLabelText ?? ""),
    textContent: vi.fn(async () => options.accountLabelText ?? ""),
    getAttribute: vi.fn(async (name: string) => name === "role" ? "text" : name === "data-testid" ? "account-id" : null),
    evaluate: vi.fn(async () => "SPAN"),
    locator: vi.fn((selector: string) => selector === "xpath=.." ? accountLabelParent : accountLabel)
  });
  const entry = locator({
    count: vi.fn(async () => (currentUrl.endsWith("/") || currentUrl.endsWith("/new/home")) && options.publishEntryMode !== "generic-publish" ? options.entryCount ?? 1 : 0),
    innerText: vi.fn(async () => "发布图文笔记"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? "/publish/publish" : name === "aria-label" ? "图文笔记" : null),
    click: entryClick
  });
  const videoEntry = locator({
    count: vi.fn(async () => currentUrl.endsWith("/") ? options.videoEntryCount ?? 0 : 0),
    innerText: vi.fn(async () => "发布视频"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? "/publish/video" : null)
  });
  const publishEntry = locator({
    count: vi.fn(async () => options.publishEntryMode === "generic-publish" && (currentUrl.endsWith("/") || currentUrl.endsWith("/new/home")) ? options.publishEntryCount ?? 1 : 0),
    innerText: vi.fn(async () => "发布"),
    getAttribute: vi.fn(async (name: string) => name === "data-testid" ? "publish-entry" : name === "aria-label" ? "发布" : null),
    click: vi.fn(async () => { if (options.publishEntryClickFails) throw new Error("publish entry click failed"); contentTypeShown = true; calls.push("publish-entry-click"); })
  });
  const publishEntryCandidates = {
    count: vi.fn(async () => {
      if (!(currentUrl.endsWith("/") || currentUrl.endsWith("/new/home"))) return 0;
      return options.publishEntryMode === "generic-publish" ? options.publishEntryCount ?? 1 : options.entryCount ?? 1;
    }),
    nth: vi.fn((_index: number) => options.publishEntryMode === "generic-publish" ? publishEntry : entry)
  } as unknown as Locator;
  const contentTypeEntry = locator({
    count: vi.fn(async () => contentTypeShown ? options.contentTypeEntryCount ?? 1 : 0),
    innerText: vi.fn(async () => "图文"),
    getAttribute: vi.fn(async (name: string) => name === "data-testid" ? "content-type-image" : name === "aria-label" ? "图文" : null),
    click: vi.fn(async () => { if (options.contentTypeSelectionFails) throw new Error("content type selection failed"); if (options.contentTypeSelectionEnabled !== false) { setActivePageUrl?.("https://creator.xiaohongshu.com/publish/publish"); currentUrl = "https://creator.xiaohongshu.com/publish/publish"; } calls.push("content-type-click"); })
  });
  const title = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? options.titleCount ?? 1 : 0),
    inputValue: vi.fn(async () => options.titleReadback ?? titleValue),
    innerText: vi.fn(async () => options.titleReadback ?? titleValue),
    fill: vi.fn(async (value: string) => { titleValue = value; calls.push("title-fill"); }),
    getAttribute: vi.fn(async (name: string) => ({ placeholder: "填写标题", "aria-label": "笔记标题", name: "title", id: "note-title" }[name] ?? null))
  });
  const body = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? options.bodyCount ?? 1 : 0),
    innerText: vi.fn(async () => options.bodyReadback ?? bodyValue),
    textContent: vi.fn(async () => options.bodyReadback ?? bodyValue),
    fill: vi.fn(async (value: string) => { bodyValue = value; calls.push("body-fill"); }),
    getAttribute: vi.fn(async (name: string) => ({ role: "textbox", contenteditable: "true", "data-placeholder": "填写正文", class: "note-editor ProseMirror" }[name] ?? null))
  });
  const fileInputHandle = {
    setInputFiles: inputSetFiles,
    evaluate: vi.fn(async (pageFunction: unknown) => {
      if (String(pageFunction).includes("inputElement.files")) {
        return {
          filesLength: imageUploaded ? 1 : 0,
          files: imageUploaded ? [{ name: "task10s-safe-test.png", size: 19226, type: "image/png", lastModified: 1788393600000 }] : []
        };
      }
      return {
        tagName: "INPUT",
        type: "file",
        accept: "image/*",
        multiple: false,
        disabled: false,
        connected: true,
        classNameSafe: "upload-input"
      };
    })
  };
  const fileInput = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? options.fileInputCount ?? 1 : 0),
    setInputFiles: inputSetFiles,
    elementHandle: vi.fn(async () => fileInputHandle),
    getAttribute: vi.fn(async (name: string) => name === "accept" ? "image/*" : name === "aria-label" ? "上传图片" : null)
  });
  const preview = locator({
    count: vi.fn(async () => imageUploaded ? options.imagePreviewCount ?? 1 : 0),
    isVisible: vi.fn(async () => imageUploaded),
    getAttribute: vi.fn(async (name: string) => name === "src" ? "https://sns-webpic-qc.xhscdn.com/test-image.png" : null)
  });
  const loading = locator({
    count: vi.fn(async () => options.imageLoading ? 1 : 0),
    isVisible: vi.fn(async () => Boolean(options.imageLoading)),
    innerText: vi.fn(async () => "上传中")
  });
  const required = locator({
    count: vi.fn(async () => options.requiredEmpty ? 1 : 0),
    innerText: vi.fn(async () => options.requiredEmpty ? "话题" : ""),
    inputValue: vi.fn(async () => options.requiredEmpty ? "" : "已填写"),
    getAttribute: vi.fn(async (name: string) => name === "aria-required" ? "true" : name === "aria-label" ? "话题" : null)
  });
  const settings = locator({
    count: vi.fn(async () => options.settings?.length ?? 0),
    nth: vi.fn((index: number) => locator({
      innerText: vi.fn(async () => options.settings?.[index]?.label ?? ""),
      getAttribute: vi.fn(async (name: string) => name === "aria-required" ? options.settings?.[index]?.required ? "true" : null : name === "aria-checked" ? options.settings?.[index]?.value : null)
    }))
  });
  const submit = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? options.submitCount ?? 1 : 0),
    isEnabled: vi.fn(async () => options.submitEnabled !== false),
    innerText: vi.fn(async () => "发布笔记"),
    getAttribute: vi.fn(async (name: string) => name === "aria-label" ? "发布笔记" : name === "data-confirm" ? options.secondConfirmation ? "true" : null : null),
    click: submitClick
  });
  const intermediateAction = locator({
    count: vi.fn(async () => imageUploaded && intermediateActionVisible ? 1 : 0),
    innerText: vi.fn(async () => "下一步"),
    boundingBox: vi.fn(async () => ({ x: 240, y: 20, width: 96, height: 40 })),
    getAttribute: vi.fn(async (name: string) => name === "role" ? "button" : null),
    click: vi.fn(async () => { intermediateActionVisible = false; calls.push("intermediate-next-click"); })
  });
  const secondConfirm = locator({
    count: vi.fn(async () => options.secondConfirmation ? 1 : 0),
    innerText: vi.fn(async () => "确认发布")
  });
  const empty = locator();
  const pageRoot = locator({ innerText: vi.fn(async () => `${options.accountName ?? "XHS owner"} ${options.securityText ?? ""} ${options.imageFailed ? "图片上传失败" : ""}`) });
  const nativePickerCancel = vi.fn(async () => {
    if (options.nativePickerCancelFails) throw new Error("picker cancel failed");
    setActivePageUrl?.("https://creator.xiaohongshu.com/publish/publish");
    currentUrl = "https://creator.xiaohongshu.com/publish/publish";
  });
  const createPage = (initialUrl: string, onClose?: () => void): Page => {
    let pageUrl = initialUrl;
    let closed = false;
    const keyboardPress = vi.fn(async (_key: string) => {
      if (options.nativePickerCancelFails) throw new Error("picker cancel failed");
      if (_key === "Escape") {
        setActivePageUrl?.("https://creator.xiaohongshu.com/publish/publish");
        currentUrl = "https://creator.xiaohongshu.com/publish/publish";
      }
    });
    const page = {
      goto: vi.fn(async (_url: string) => {
        pageUrl = options.loginPage ? "https://www.xiaohongshu.com/login" : creatorHomeUrl;
        currentUrl = pageUrl;
      }),
      url: vi.fn(() => pageUrl),
      title: vi.fn(async () => "小红书创作服务平台"),
      ...(options.routeWaitTimeout ? { waitForTimeout: vi.fn(async () => { throw new Error("Timeout exceeded while waiting for editor route"); }) } : {}),
      frames: vi.fn(() => []),
      close: vi.fn(async () => {
        closed = true;
        contextPages = contextPages.filter((candidate) => candidate !== page);
        onClose?.();
      }),
      isClosed: vi.fn(() => closed),
      context: vi.fn(() => pageContextRef.value as BrowserSession["context"]),
      keyboard: { press: keyboardPress },
      cancelNativeFilePicker: nativePickerCancel,
      locator: vi.fn((selector: string) => {
        currentUrl = pageUrl;
        if (selector === "body") return pageRoot;
        if (selector === 'a, button, [role="button"]') {
          setActivePageUrl = (url: string) => { pageUrl = url; currentUrl = url; };
          return publishEntryCandidates;
        }
        if (selector === "a[href]") return profile;
        if (selector === "text=小红书账号") return accountLabel;
        if (selector.includes("data-testid*='publish'") || selector.includes('data-testid*="publish"')) return publishEntry;
        if (selector.includes("content-type-image")) return contentTypeEntry;
        if (selector.includes("nickname") || selector.includes("账号")) return nickname;
        if (selector.includes("/publish/video") || selector.includes("视频")) return videoEntry;
        if (selector.includes("/publish/publish") || selector.includes("图文") || selector.includes("笔记")) {
          setActivePageUrl = (url: string) => { pageUrl = url; currentUrl = url; };
          return entry;
        }
        if (selector.includes("input[type=\"file\"]") || selector.includes("input[type='file']")) return fileInput;
        if (selector.includes("preview") || selector.includes("upload-result") || selector.includes("note-image")) return preview;
        if (selector.includes("loading") || selector.includes("progress") || selector.includes("上传中")) return loading;
        if (selector.includes("required") || selector.includes("aria-required")) return required;
        if (selector.includes("checkbox") || selector.includes("radio") || selector.includes("setting")) return settings;
        if (selector.includes("[role=\"tab\"]") || selector.includes("[role=\"button\"]")) return intermediateActionVisible ? intermediateAction : submit;
        if (selector.includes("button") || selector.includes("[role=\"button\"]")) return submit;
        if (selector.includes("确认发布")) return secondConfirm;
        if (selector.includes("textarea") || selector.includes("contenteditable") || selector.includes("textbox") || selector.includes("正文")) return body;
        if (selector.includes("title") || selector.includes("标题") || selector.includes("placeholder")) return title;
        return empty;
      })
    } as unknown as Page;
    return page;
  };
  const page = createPage(currentUrl);
  contextPages = options.pagePresentInContext === false ? [] : [page];
  const context = {
    pages: vi.fn(() => [...contextPages]),
    newPage: vi.fn(async () => {
      const operationPage = createPage(creatorHomeUrl);
      contextPages = [...contextPages, operationPage];
      return operationPage;
    }),
    ...(options.closedShadowFinalSubmit ? {
      newCDPSession: vi.fn(async () => ({
        send: vi.fn(async (method: string) => {
          if (method === "DOM.getDocument") {
            return {
              root: {
                nodeId: 1,
                nodeName: "HTML",
                children: [{
                  nodeId: 2,
                  nodeName: "XHS-PUBLISH-BTN",
                  attributes: ["is-publish", "true", "is-save-draft", "true", "submit-text", "发布", "save-text", "暂存离开", "submit-disabled", "false", "submit-loading", "false"],
                  shadowRoots: [{
                    nodeId: 3,
                    nodeName: "#document-fragment",
                    children: [{
                      nodeId: 4,
                      nodeName: "BUTTON",
                      attributes: ["type", "button", "aria-disabled", "false", "aria-busy", "false"],
                      children: [{ nodeId: 5, nodeName: "#text", nodeValue: "发布" }]
                    }]
                  }]
                }]
              }
            };
          }
          if (method === "CSS.getComputedStyleForNode") return { computedStyle: [{ name: "display", value: "block" }, { name: "visibility", value: "visible" }, { name: "pointer-events", value: "auto" }] };
          if (method === "DOM.getBoxModel") return { model: { border: [0, 0, 120, 0, 120, 40, 0, 40] } };
          return {};
        }),
        detach: vi.fn(async () => undefined)
      }))
    } : {})
  };
  pageContextRef.value = context as unknown as BrowserSession["context"];
  const session = {
    browser: { isConnected: vi.fn(() => true) },
    page,
    executionMode: "VISIBLE",
    headless: false,
    hasStoredSession: true,
    sessionIdHash: `session-${options.accountId ?? "account-a"}`,
    storageMode: "PERSISTENT_PROFILE",
    profilePath: null,
    browserChannel: "chrome",
    credentialSnapshotInjected: false,
    contextDebugId: "context-debug-id",
    pageDebugId: "canonical-page-debug-id",
    context
  } as unknown as BrowserSession;
  const open = vi.fn(async (identity: { platformKey: string; accountId: string }) => {
    calls.push(`open:${identity.platformKey}:${identity.accountId}`);
    return session;
  });
  const manager = {
    debugId: "manager-debug-id",
    hasStoredSession: vi.fn(() => true),
    open,
    save: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    clear: vi.fn(),
    closeAll: vi.fn(async () => undefined),
    __fixtureState: {
      session,
      context,
      createOperationPage: () => {
        const operationPage = createPage(options.operationPageInitialUrl ?? creatorHomeUrl);
        contextPages = [...contextPages, operationPage];
        operationPages.push(operationPage);
        return operationPage;
      }
    }
  } as unknown as BrowserSessionManager;
  const phaseSnapshot = (): Record<string, unknown> => {
    const postUpload = imageUploaded;
    const intermediate = postUpload && intermediateActionVisible;
    const uploadPresent = (options.fileInputCount ?? 1) > 0;
    return {
      currentUrl,
      readyState: "complete",
      shellSignal: currentUrl.includes("/publish/publish"),
      shellFingerprint: postUpload ? "fixture-post-upload-shell" : "fixture-pre-upload-shell",
      contentTypeSignal: "IMAGE_POST",
      securityVerificationPresent: false,
      loginPagePresent: false,
      preUploadSemanticSignalPresent: true,
      phaseTopology: {
        titleCandidateCount: postUpload && !intermediate ? options.titleCount ?? 1 : 0,
        bodyCandidateCount: postUpload && !intermediate ? options.bodyCount ?? 1 : 0,
        uploadCandidateCount: options.fileInputCount ?? 1,
        finalSubmitCandidateCount: postUpload && !intermediate ? options.submitCount ?? 1 : 0,
        contenteditableCount: postUpload && !intermediate ? 1 : 0,
        textareaCount: 0,
        textInputCount: postUpload && !intermediate ? 1 : 0,
        fileInputCount: options.fileInputCount ?? 1,
        buttonCount: postUpload && !intermediate ? options.submitCount ?? 1 : 2,
        roleButtonCount: 0,
        semanticSignals: ["upload", "image"],
        stable: false
      },
      preUploadSemanticNodes: [{ tagName: "DIV", normalizedText: "上传图片", role: "button", visible: true, enabled: true, boundingBox: { x: 10, y: 20, width: 120, height: 40 }, nearestInteractiveAncestorTag: "DIV", nearestInteractiveAncestorRole: "button" }],
      uploadControlRelationships: uploadPresent ? [{ candidateId: "fixture-upload-0", tagName: "INPUT", type: "file", accept: "image/*", multiple: true, enabled: true, visible: false, usableSurface: true, surfaceSignal: "visible-upload-ancestor", ancestors: [] }] : [],
      tabPresence: { uploadVideoTabPresent: true, uploadImageTabPresent: true, longFormTabPresent: true, podcastTabPresent: true, currentSelectedTab: "上传图文" },
      uploadBusy: Boolean(options.imageLoading && !postUpload),
      previewReady: postUpload && (options.imagePreviewCount ?? 1) > 0,
      mediaPreviewSignalPresent: intermediate,
      mediaEditingSignalPresent: false,
      mediaPreviewDiagnostics: { previewCount: postUpload ? 1 : 0, previewVisible: postUpload, previewGeometry: postUpload ? [{ x: 20, y: 80, width: 160, height: 160 }] : [], deleteReplaceEditSignals: [], associatedSemanticText: postUpload ? ["预览"] : [] },
      intermediateActionCandidates: intermediate ? [{ candidateId: "intermediate-action-0", tagName: "BUTTON", role: "button", semanticSignal: "intermediate-action", normalizedText: "下一步", visible: true, enabled: true, boundingBox: { x: 240, y: 20, width: 96, height: 40 }, nearestInteractiveAncestorTag: "BUTTON", nearestInteractiveAncestorRole: "button", pointerEvents: "auto", hitTestValid: true }] : [],
      modalDiagnostics: { dialogCount: 0, modalSignalCount: 0, maskCount: 0, overlayCount: 0, drawerCount: 0, visible: false, ariaModalCount: 0 }
    };
  };
  const postUploadSnapshot = (): Record<string, unknown> => {
    const imageItemPresent = imageUploaded && (options.editorScopedImageItemCount ?? options.imagePreviewCount ?? 1) > 0;
    const intermediate = imageUploaded && intermediateActionVisible;
    const titleVisible = imageUploaded && !intermediate && (options.titleCount ?? 1) > 0;
    const bodyVisible = imageUploaded && !intermediate && (options.bodyCount ?? 1) > 0;
    const submitCount = imageUploaded && !intermediate ? options.submitCount ?? 1 : 0;
    return {
      origin: "https://creator.xiaohongshu.com",
      pathname: "/publish/publish",
      readyState: "complete",
      editorRegionPresent: imageItemPresent || (titleVisible && bodyVisible),
      imageItems: imageItemPresent ? [{ tagName: "IMG", classNameSafe: "image-item", boundingRect: { x: 20, y: 80, width: 160, height: 160 }, display: "block", visibility: "visible", pointerEvents: "auto", imgPresent: true, imgNaturalWidth: 1080, imgNaturalHeight: 1440, complete: true, blobUrlPresent: true, dataUrlPresent: false, backgroundImagePresent: false, connected: true, visible: true }] : [],
      visibleImageItemCount: imageItemPresent ? 1 : 0,
      imageCounterTextSafe: imageItemPresent ? "1/18" : null,
      addImageControlPresent: imageUploaded,
      deleteImageControlCount: imageItemPresent ? 1 : 0,
      titleControlMatchCount: titleVisible ? 1 : 0,
      titleControlVisible: titleVisible,
      bodyControlMatchCount: bodyVisible ? 1 : 0,
      bodyControlVisible: bodyVisible,
      finalSubmitCandidateCount: submitCount,
      finalSubmitVisibleCount: submitCount,
      finalSubmitProof: submitCount === 1 ? "PASS" : submitCount > 1 ? "AMBIGUOUS" : "NOT_PROVEN",
      explicitUploadErrorSignals: options.imageFailed ? ["图片上传失败"] : [],
      processingSignalPresent: Boolean(options.imageLoading)
    };
  };
  const keyboardPress = (page as unknown as { keyboard: { press: ReturnType<typeof vi.fn> } }).keyboard.press;
  const fixture = { page, manager, submitClick, inputSetFiles, entryClick, open, operationPageDebugIds, operationContextDebugIds, operationPages, calls, session, keyboardPress, nativePickerCancel, phaseSnapshot, postUploadSnapshot };
  installSharedConnectionLifecycle(fixture);
  installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
  return fixture;
}

function installPageEvidence(fixture: Fixture, options: {
  positiveSignals?: string[];
  blockingSignals?: string[];
  displayName?: string | null;
  externalAccountId?: string | null;
  profileUrl?: string | null;
  domLocationHref?: string;
}): void {
  (fixture.page as unknown as { evaluate: (pageFunction: () => unknown) => Promise<unknown> }).evaluate = vi.fn(async (pageFunction?: () => unknown) => {
    if (typeof pageFunction === "function" && String(pageFunction).includes("phaseTopology")) return fixture.phaseSnapshot();
    if (typeof pageFunction === "function" && String(pageFunction).includes("imageCandidateElements")) return fixture.postUploadSnapshot();
    if (typeof pageFunction === "function" && /^\(\)\s*=>\s*location\.href\s*$/u.test(String(pageFunction).trim())) return options.domLocationHref ?? fixture.page.url();
    return ({
    available: true,
    bodyPresent: true,
    bodyTextLength: 512,
    login: {
      available: true,
      url: "https://creator.xiaohongshu.com/new/home",
      creatorHost: true,
      creatorHomePath: true,
      explicitLoginUrl: false,
      verificationUrl: false,
      publishNoteVisible: (options.positiveSignals ?? ["发布笔记", "笔记管理"]).includes("发布笔记"),
      noteManagementVisible: (options.positiveSignals ?? ["发布笔记", "笔记管理"]).includes("笔记管理"),
      dataDashboardVisible: (options.positiveSignals ?? []).includes("数据看板"),
      accountStatusVisible: (options.positiveSignals ?? []).includes("账号状态正常"),
      profileAreaVisible: Boolean(options.displayName || options.externalAccountId),
      visibleLoginForm: false,
      visibleQrLogin: false,
      visibleSmsVerification: false,
      visibleCaptcha: false,
      visibleSlider: false,
      visibleSecurityModal: false,
      positiveSignals: options.positiveSignals ?? ["发布笔记", "笔记管理"],
      blockingSignals: options.blockingSignals ?? []
    },
    identity: {
      displayName: options.displayName ?? null,
      externalAccountId: options.externalAccountId ?? null,
      externalAccountIdCandidates: options.externalAccountId ? [options.externalAccountId] : [],
      profileUrl: options.profileUrl ?? null
    }
    });
  });
}

function context(accountId = "account-a") {
  return { accountId, accountName: "XHS owner", platformKey: "xiaohongshu", settings: { browserExecutionMode: "VISIBLE", triggerSource: "START_PUBLISH", userActionId: `action-${accountId}` } };
}

describe("Xiaohongshu BrowserAutomation article gate", () => {
  it("runs the fixed publish-editor DOM diagnostic on the retained canonical Page without mutation", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    vi.mocked(fixture.page.goto).mockClear();
    const labels = ["上传视频", "上传图文", "写长文", "发播客", "上传图片", "文字配图"].map((label) => ({ label, exactTextMatchCount: label === "上传图文" || label === "上传图片" ? 1 : 0, nodes: [] }));
    (fixture.page as unknown as { evaluate: ReturnType<typeof vi.fn> }).evaluate.mockResolvedValue({ origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", labels, actualSelectedTabSignal: "ARIA_SELECTED", fileInputs: [{ type: "file", accept: "image/*", multiple: true, disabled: false, classNameSafe: "upload-input" }] });

    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuPublishEditorDom: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuPublishEditorDom;
    const result = await diagnostic.call(adapter, ctx);

    expect(result).toMatchObject({ inspectionStatus: "PASS", origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", target: "image", actualSelectedTabSignal: "ARIA_SELECTED" });
    expect(result.fileInputs).toHaveLength(1);
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("exposes post-upload reconciliation on the retained canonical Page without a second upload", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?target=image" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    (fixture.manager as unknown as { getCanonicalPage: ReturnType<typeof vi.fn> }).getCanonicalPage = vi.fn(() => ({ session: fixture.session, page: fixture.page, pageDebugId: "canonical-post-upload-page" }));
    vi.mocked(fixture.page.evaluate).mockResolvedValue({
      origin: "https://creator.xiaohongshu.com",
      pathname: "/publish/publish",
      readyState: "complete",
      editorRegionPresent: true,
      imageItems: [{ tagName: "IMG", classNameSafe: "preview", boundingRect: { x: 10, y: 20, width: 120, height: 120 }, display: "block", visibility: "visible", pointerEvents: "auto", imgPresent: true, imgNaturalWidth: 1080, imgNaturalHeight: 1440, complete: true, blobUrlPresent: true, dataUrlPresent: false, backgroundImagePresent: false, connected: true, visible: true }],
      visibleImageItemCount: 1,
      imageCounterTextSafe: "1/18",
      addImageControlPresent: true,
      deleteImageControlCount: 1,
      titleControlMatchCount: 1,
      titleControlVisible: true,
      bodyControlMatchCount: 1,
      bodyControlVisible: true,
      finalSubmitCandidateCount: 0,
      finalSubmitVisibleCount: 0,
      finalSubmitProof: "NOT_PROVEN",
      explicitUploadErrorSignals: [],
      processingSignalPresent: false
    });

    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuPostUploadReconciliation: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuPostUploadReconciliation;
    const result = await diagnostic.call(adapter, ctx);

    expect(result).toMatchObject({ inspectionStatus: "PASS", imageUploadReconciliation: "PASS", postUploadState: "EDITOR_READY", imageAssetRenderedCount: 1, titleControlPresent: true, bodyControlPresent: true, finalSubmitProof: "NOT_PROVEN" });
    expect(result.pageId).toBe("canonical-post-upload-page");
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("reads the retained canonical file input without mutating the page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?target=image" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    (fixture.manager as unknown as { getCanonicalPage: ReturnType<typeof vi.fn> }).getCanonicalPage = vi.fn(() => ({ session: fixture.session, page: fixture.page, pageDebugId: "canonical-file-input-page" }));
    vi.mocked(fixture.page.goto).mockClear();
    vi.mocked(fixture.page.evaluate).mockResolvedValue({
      origin: "https://creator.xiaohongshu.com",
      pathname: "/publish/publish",
      readyState: "complete",
      matchCount: 1,
      inputs: [{
        type: "file",
        accept: "image/*",
        multiple: false,
        disabled: false,
        connected: true,
        classNameSafe: "upload-input",
        ancestorFingerprint: [{ tagName: "DIV", classNameSafe: "upload-panel" }],
        filesLength: 1,
        files: [{ name: "task10s-safe-test.png", size: 19226, type: "image/png", lastModified: 1788393600000, expectedFixtureMatch: true }]
      }]
    });

    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuFileInputState: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuFileInputState;
    const result = await diagnostic.call(adapter, ctx);

    expect(result).toMatchObject({ inspectionStatus: "PASS", pageId: "canonical-file-input-page", matchCount: 1, fileInputContainsExpectedFixture: "YES" });
    expect((result.inputs as Array<{ filesLength: number }>)[0]?.filesLength).toBe(1);
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("fails closed before evaluate for a foreign origin and without an active session", async () => {
    const foreignFixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?target=image" });
    const foreignAdapter = new XiaohongshuBrowserAdapter({ sessionManager: foreignFixture.manager });
    const ctx = context("account-a");
    await foreignAdapter.connectAccount(ctx);
    vi.mocked(foreignFixture.page.url).mockReturnValue("https://example.com/publish/publish?target=image");
    vi.mocked(foreignFixture.page.evaluate).mockClear();
    const foreignDiagnostic = (foreignAdapter as unknown as { inspectCurrentXiaohongshuPublishEditorDom: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuPublishEditorDom;
    await expect(foreignDiagnostic.call(foreignAdapter, ctx)).resolves.toMatchObject({ inspectionStatus: "FAIL", failureCode: "CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", origin: "https://example.com", pathname: "/publish/publish" });
    expect(foreignFixture.page.evaluate).not.toHaveBeenCalled();
    const foreignFileInputDiagnostic = (foreignAdapter as unknown as { inspectCurrentXiaohongshuFileInputState: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuFileInputState;
    await expect(foreignFileInputDiagnostic.call(foreignAdapter, ctx)).resolves.toMatchObject({ inspectionStatus: "FAIL", failureCode: "CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE" });
    expect(foreignFixture.page.evaluate).not.toHaveBeenCalled();

    const unavailableFixture = setupPage();
    const unavailableAdapter = new XiaohongshuBrowserAdapter({ sessionManager: unavailableFixture.manager });
    const unavailableDiagnostic = (unavailableAdapter as unknown as { inspectCurrentXiaohongshuPublishEditorDom: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuPublishEditorDom;
    await expect(unavailableDiagnostic.call(unavailableAdapter, ctx)).resolves.toMatchObject({ inspectionStatus: "FAIL", failureCode: "BROWSER_SESSION_UNAVAILABLE", sessionExists: false });
    expect(unavailableFixture.open).not.toHaveBeenCalled();
  });

  it("exposes a retained canonical-page image-editor readiness diagnostic without mutation", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    (fixture.manager as unknown as { getCanonicalPage: ReturnType<typeof vi.fn> }).getCanonicalPage = vi.fn(() => ({ session: fixture.session, page: fixture.page, pageDebugId: "canonical-from-registry" }));
    vi.mocked(fixture.page.goto).mockClear();
    const diagnostic = (adapter as unknown as {
      inspectCurrentXiaohongshuImageEditorReadiness: (input: AccountContext) => Promise<Record<string, unknown>>;
    }).inspectCurrentXiaohongshuImageEditorReadiness;

    expect(diagnostic).toBeTypeOf("function");
    const result = await diagnostic.call(adapter, ctx);

    expect(result).toMatchObject({
      inspectionStatus: "PASS",
      preUploadPhaseResult: "PASS",
      contentType: "IMAGE_POST",
      imageUploadControlPresent: true,
      editorShellPresent: true,
      origin: "https://creator.xiaohongshu.com",
      pathname: "/publish/publish",
      from: "menu",
      target: "image",
      uploadImageTabPresent: true,
      currentSelectedTab: "上传图文"
    });
    expect(result.pageId).toBe("canonical-from-registry");
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
    expect(fixture.calls).not.toContain("title-fill");
    expect(fixture.calls).not.toContain("body-fill");
  });

  it("executes on an editor route but reports semantic failure when the editor upload capability is absent", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image", fileInputCount: 0 });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuImageEditorReadiness: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuImageEditorReadiness;

    await expect(diagnostic.call(adapter, ctx)).resolves.toMatchObject({ inspectionStatus: "PASS", preUploadPhaseResult: "FAIL", contentType: "IMAGE_POST", imageUploadControlPresent: false });
  });

  it("fails closed without an active canonical session and never cold-opens it", async () => {
    const fixture = setupPage();
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuImageEditorReadiness: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuImageEditorReadiness;

    await expect(diagnostic.call(adapter, ctx)).resolves.toMatchObject({ inspectionStatus: "FAIL", failureCode: "BROWSER_SESSION_UNAVAILABLE", sessionExists: false });
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("rejects a closed retained canonical Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?target=image" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    vi.mocked(fixture.page.isClosed).mockReturnValue(true);

    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuImageEditorReadiness: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuImageEditorReadiness;
    await expect(diagnostic.call(adapter, ctx)).resolves.toMatchObject({ inspectionStatus: "FAIL", failureCode: "CANONICAL_PAGE_CLOSED", sessionExists: true, pageClosed: true });
  });

  it("rejects a foreign origin before DOM editor inspection", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish?target=image" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    vi.mocked(fixture.page.url).mockReturnValue("https://example.com/publish/publish?target=image");
    vi.mocked(fixture.page.evaluate).mockClear();

    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuImageEditorReadiness: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuImageEditorReadiness;
    await expect(diagnostic.call(adapter, ctx)).resolves.toMatchObject({ inspectionStatus: "FAIL", failureCode: "CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", origin: "https://example.com", pathname: "/publish/publish", target: "image" });
    expect(fixture.page.evaluate).not.toHaveBeenCalled();
  });

  it("rejects a non-editor pathname before DOM editor inspection", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home?source=official" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    vi.mocked(fixture.page.url).mockReturnValue("https://creator.xiaohongshu.com/new/home?source=official");
    vi.mocked(fixture.page.evaluate).mockClear();

    const diagnostic = (adapter as unknown as { inspectCurrentXiaohongshuImageEditorReadiness: (input: AccountContext) => Promise<Record<string, unknown>> }).inspectCurrentXiaohongshuImageEditorReadiness;
    await expect(diagnostic.call(adapter, ctx)).resolves.toMatchObject({ inspectionStatus: "FAIL", failureCode: "CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", origin: "https://creator.xiaohongshu.com", pathname: "/new/home", source: "official" });
    expect(fixture.page.evaluate).not.toHaveBeenCalled();
  });

  it("requires creator host plus two unique positive signals and keeps login/security blockers higher priority", () => {
    const base: XiaohongshuLoginEvidence = {
      available: true,
      url: "https://creator.xiaohongshu.com/new/home",
      creatorHost: true,
      creatorHomePath: true,
      explicitLoginUrl: false,
      verificationUrl: false,
      publishNoteVisible: false,
      noteManagementVisible: false,
      dataDashboardVisible: false,
      accountStatusVisible: false,
      profileAreaVisible: false,
      visibleLoginForm: false,
      visibleQrLogin: false,
      visibleSmsVerification: false,
      visibleCaptcha: false,
      visibleSlider: false,
      visibleSecurityModal: false,
      positiveSignals: [],
      blockingSignals: []
    };
    expect(classifyXiaohongshuLoginEvidence({ ...base, positiveSignals: ["发布笔记", "笔记管理"] })).toBe("logged_in");
    expect(classifyXiaohongshuLoginEvidence({ ...base, positiveSignals: ["发布笔记"] })).toBe("unknown");
    expect(classifyXiaohongshuLoginEvidence({ ...base, creatorHost: false, positiveSignals: ["发布笔记", "笔记管理"] })).toBe("unknown");
    expect(classifyXiaohongshuLoginEvidence({ ...base, positiveSignals: ["发布笔记", "笔记管理"], blockingSignals: ["visible_security_modal"] })).toBe("needs_user_action");
    expect(classifyXiaohongshuLoginEvidence({ ...base, explicitLoginUrl: true, positiveSignals: ["发布笔记", "笔记管理"] })).toBe("login_required");
  });

  it("evaluates the existing creator home without navigating away and emits raw login evidence", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板", "创作服务平台", "账号状态正常"], displayName: "苏州别墅光伏", externalAccountId: "960803317" });
    const evaluations: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onLoginEvaluation: (evaluation: Record<string, unknown>) => evaluations.push(evaluation) } as never);

    await adapter.connectAccount(context());
    await expect(adapter.completeConnection(context())).resolves.toBe("logged_in");

    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({
      phase: "COMPLETE_LOGIN_CHECK",
      pageUrl: "https://creator.xiaohongshu.com/new/home",
      pageIsClosed: false,
      creatorDomain: true,
      creatorHomePath: true,
      publishNoteVisible: true,
      noteManagementVisible: true,
      dataDashboardVisible: true,
      accountStatusVisible: true,
      profileAreaVisible: true,
      visibleLoginForm: false,
      visibleQrLogin: false,
      visibleSmsVerification: false,
      visibleCaptcha: false,
      visibleSlider: false,
      visibleSecurityModal: false,
      positiveSignalCount: 5,
      blockingSignalCount: 0,
      loginClassification: "logged_in"
    });
  });

  it("marks the deferred completed-login runtime authenticated before identity proof", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", accountLabelText: "小红书账号：960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    expect(fixture.manager.getRuntimeAuthState(ctx).state).toBe("UNVERIFIED");

    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");

    expect(fixture.manager.getRuntimeAuthState(ctx)).toMatchObject({ state: "AUTHENTICATED", contextDebugId: "context-debug-id" });
  });

  it("emits live-login and before-close auth diagnostics without exposing storage values", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      loginStabilityWindowMs: 0,
      onAuthStateDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    const lifecycle = adapter as unknown as { persistConnectionSession: (context: AccountContext) => Promise<void> };
    await lifecycle.persistConnectionSession(ctx);

    expect(diagnostics.map((diagnostic) => diagnostic.phase)).toEqual(["LIVE_LOGIN_BEFORE_CLOSE", "AUTH_STATE_BEFORE_CLOSE"]);
    expect(diagnostics[0]).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", stableObservationPassed: true });
    expect(diagnostics[1]).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", authState: null });
    expect(JSON.stringify(diagnostics)).not.toMatch(/"value"|secret/iu);
  });

  it("exposes an article-only BrowserAutomation capability", () => {
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: setupPage().manager });
    expect(adapter.manifest).toMatchObject({ platformKey: "xiaohongshu", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false });
    expect(adapter.getCapabilities()).toMatchObject({ article: true, imagePost: true, video: false, maxImageCount: 18 });
  });

  it("probes a new Page in the same account-owned Context without changing account identity", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installSharedConnectionLifecycle(fixture);
    const session = await fixture.open({ platformKey: "xiaohongshu", accountId: "account-a" });
    let pages: Page[] = [fixture.page];
    (fixture.page as unknown as { close: () => Promise<void> }).close = vi.fn(async () => { pages = []; });
    const newPage = {
      url: vi.fn(() => "https://creator.xiaohongshu.com/"),
      goto: vi.fn(async () => undefined),
      close: vi.fn(async () => { pages = pages.filter((page) => page !== newPage); }),
      isClosed: vi.fn(() => false)
    } as unknown as Page;
    const ownedContext = session.context as unknown as { pages: () => Page[]; newPage: () => Promise<Page> };
    ownedContext.pages = vi.fn(() => pages);
    ownedContext.newPage = vi.fn(async () => { pages = [...pages, newPage]; return newPage; });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    const result = await adapter.openSameContextDiagnosticPage(context("account-a"));

    expect(result).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", originalPageClosed: true, newPageOwnedByContext: true, pageCountBefore: 1, pageCountAfter: 1, newPageUrl: "https://creator.xiaohongshu.com/" });
    expect(ownedContext.newPage).toHaveBeenCalledTimes(1);
    expect(newPage.close).not.toHaveBeenCalled();
  });

  it("recognizes a logged-in account and returns stable profile identity", async () => {
    const fixture = setupPage({ accountId: "account-a", profileHref: "https://www.xiaohongshu.com/user/profile/65abc123", accountName: "小红书账号 A" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context("account-a"));
    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("logged_in");
    await expect(adapter.getAccountProfile(context("account-a"))).resolves.toMatchObject({ accountId: "65abc123", accountName: "小红书账号 A" });
    expect(fixture.open).toHaveBeenCalledWith({ platformKey: "xiaohongshu", accountId: "account-a" }, expect.anything(), "VISIBLE");
  });

  it("checks an ordinary-production login on the authenticated canonical Page before creating any operation Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317" });
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"], externalAccountId: "960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = {
      ...context("account-a"),
      settings: {
        ...context("account-a").settings,
        ordinaryProduction: true,
        publishJobId: "ordinary-job-a",
        expectedExternalCreatorId: "960803317"
      }
    };

    await adapter.connectAccount(ctx);
    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");

    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
    expect(fixture.manager.closeOperationPage).not.toHaveBeenCalled();
  });

  it("records a Creator proof on the authenticated canonical Page for ordinary production", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317" });
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"], externalAccountId: "960803317" });
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = {
      ...context("account-a"),
      settings: { ...context("account-a").settings, ordinaryProduction: true, publishJobId: "ordinary-job-a", expectedExternalCreatorId: "960803317" }
    };

    await adapter.connectAccount(ctx);
    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");

    const proofs = (adapter as unknown as { productionIdentityProofs: Map<string, unknown> }).productionIdentityProofs;
    expect(proofs.get("xiaohongshu:account-a")).toMatchObject({
      creatorId: "960803317",
      browserSessionId: "runtime-session-a",
      contextId: "context-debug-id",
      pageId: "canonical-page-debug-id",
      pagePathname: "/new/home"
    });
  });

  it("uses the verified same-page Creator proof after editor navigation instead of opening a second identity Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317" });
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"], externalAccountId: "960803317" });
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = {
      ...context("account-a"),
      settings: { ...context("account-a").settings, ordinaryProduction: true, publishJobId: "ordinary-job-a", expectedExternalCreatorId: "960803317" }
    };
    const imageBytes = new Uint8Array(19226);
    const productionArticle: PublishArticleInput = {
      ...article,
      images: ["C:/fixtures/task10s-safe-test.png"],
      contentSnapshotId: "snapshot-a",
      boundImages: [{ assetId: "image-a", name: "task10s-safe-test.png", mimeType: "image/png", sha256: createHash("sha256").update(imageBytes).digest("hex"), buffer: imageBytes }]
    };

    await adapter.connectAccount(ctx);
    await adapter.checkLogin(ctx);
    const proof = (adapter as unknown as { productionIdentityProofs: Map<string, unknown> }).productionIdentityProofs.get("xiaohongshu:account-a");
    vi.mocked(fixture.page.url).mockReturnValue("https://creator.xiaohongshu.com/publish/publish");
    (adapter as unknown as { productionPages: Map<string, unknown> }).productionPages.set("ordinary-job-a", {
      accountId: "account-a", snapshotId: "snapshot-a", creatorId: "960803317", page: fixture.page, session: fixture.session,
      pageDebugId: "canonical-page-debug-id", identityProof: proof,
      imageSha256: createHash("sha256").update(imageBytes).digest("hex"), imageSurfaceHash: createHash("sha256").update("[]").digest("hex"), title: productionArticle.title, body: productionArticle.body, submitted: false
    });

    await expect((adapter as unknown as { productionSubjectAndReadback: (value: typeof ctx, value2: PublishArticleInput) => Promise<unknown> }).productionSubjectAndReadback(ctx, productionArticle)).rejects.toBeDefined();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("prepares ordinary production on that same authenticated canonical Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317", settings: [{ label: "公开范围", required: false, value: "公开" }] });
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"], externalAccountId: "960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = {
      ...context("account-a"),
      settings: {
        ...context("account-a").settings,
        ordinaryProduction: true,
        publishJobId: "ordinary-job-a",
        expectedExternalCreatorId: "960803317"
      }
    };
    const imageBytes = new Uint8Array(19226);
    const productionArticle: PublishArticleInput = {
      ...article,
      images: ["C:/fixtures/task10s-safe-test.png"],
      contentSnapshotId: "snapshot-a",
      boundImages: [{ assetId: "image-a", name: "task10s-safe-test.png", mimeType: "image/png", sha256: createHash("sha256").update(imageBytes).digest("hex"), buffer: imageBytes }]
    };

    await adapter.connectAccount(ctx);
    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");
    // The fixture intentionally lacks the real editor's post-upload surface,
    // but the route must already have selected the canonical Page before that
    // unrelated upload gate fails.
    await expect(adapter.preparePublish(ctx, productionArticle)).rejects.toMatchObject({ code: "UPLOAD_FAILED" });

    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("keeps ordinary preparation valid when platform preview image URLs rotate after the same single-image upload", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317", settings: [{ label: "公开范围", required: false, value: "公开" }] });
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"], externalAccountId: "960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = { ...context("account-a"), settings: { ...context("account-a").settings, ordinaryProduction: true, publishJobId: "ordinary-job-a", expectedExternalCreatorId: "960803317" } };
    const imageBytes = new Uint8Array(19226);
    const productionArticle: PublishArticleInput = { ...article, images: ["C:/fixtures/task10s-safe-test.png"], contentSnapshotId: "snapshot-a", boundImages: [{ assetId: "image-a", name: "task10s-safe-test.png", mimeType: "image/png", sha256: createHash("sha256").update(imageBytes).digest("hex"), buffer: imageBytes }] };

    await adapter.connectAccount(ctx);
    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");
    const proof = (adapter as unknown as { productionIdentityProofs: Map<string, unknown> }).productionIdentityProofs.get("xiaohongshu:account-a");
    await fixture.page.locator("/publish/publish").click();
    await fixture.inputSetFiles();
    await fixture.page.locator("[placeholder*=标题]").fill(productionArticle.title);
    await fixture.page.locator("textarea").fill(productionArticle.body);
    (adapter as unknown as { productionPages: Map<string, unknown> }).productionPages.set("ordinary-job-a", {
      accountId: "account-a", snapshotId: "snapshot-a", creatorId: "960803317", page: fixture.page, session: fixture.session,
      pageDebugId: "canonical-page-debug-id", identityProof: proof,
      imageSha256: createHash("sha256").update(imageBytes).digest("hex"), imageSurfaceHash: "preview-url-before-async-refresh", title: productionArticle.title, body: productionArticle.body, submitted: false
    });
    await expect((adapter as unknown as { productionSubjectAndReadback: (value: typeof ctx, value2: PublishArticleInput) => Promise<unknown> }).productionSubjectAndReadback(ctx, productionArticle)).resolves.toMatchObject({ verified: true, observedExternalCreatorId: "960803317" });
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("keeps ordinary preparation valid when one selected image has multiple editor preview representations", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317", settings: [{ label: "公开范围", required: false, value: "公开" }] });
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"], externalAccountId: "960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = { ...context("account-a"), settings: { ...context("account-a").settings, ordinaryProduction: true, publishJobId: "ordinary-job-a", expectedExternalCreatorId: "960803317" } };
    const imageBytes = new Uint8Array(19226);
    const productionArticle: PublishArticleInput = { ...article, images: ["C:/fixtures/task10s-safe-test.png"], contentSnapshotId: "snapshot-a", boundImages: [{ assetId: "image-a", name: "task10s-safe-test.png", mimeType: "image/png", sha256: createHash("sha256").update(imageBytes).digest("hex"), buffer: imageBytes }] };

    await adapter.connectAccount(ctx);
    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");
    const proof = (adapter as unknown as { productionIdentityProofs: Map<string, unknown> }).productionIdentityProofs.get("xiaohongshu:account-a");
    await fixture.page.locator("/publish/publish").click();
    await fixture.inputSetFiles();
    await fixture.page.locator("[placeholder*=标题]").fill(productionArticle.title);
    await fixture.page.locator("textarea").fill(productionArticle.body);
    const originalEvaluate = (fixture.page as unknown as { evaluate: (fn: () => unknown) => Promise<unknown> }).evaluate;
    (fixture.page as unknown as { evaluate: (fn: () => unknown) => Promise<unknown> }).evaluate = vi.fn(async (fn: () => unknown) => {
      if (String(fn).includes("imageCandidateElements")) {
        const oneImage = {
          tagName: "IMG", classNameSafe: "editor-preview", boundingRect: { x: 20, y: 80, width: 160, height: 160 }, display: "block", visibility: "visible", pointerEvents: "auto", imgPresent: true, imgNaturalWidth: 1080, imgNaturalHeight: 1440, complete: true, blobUrlPresent: false, dataUrlPresent: false, backgroundImagePresent: false, connected: true, visible: true
        };
        return { ...fixture.postUploadSnapshot(), imageItems: [oneImage, oneImage, oneImage, oneImage], visibleImageItemCount: 4, imageCounterTextSafe: "1/18" };
      }
      return originalEvaluate(fn);
    });
    (adapter as unknown as { productionPages: Map<string, unknown> }).productionPages.set("ordinary-job-a", {
      accountId: "account-a", snapshotId: "snapshot-a", creatorId: "960803317", page: fixture.page, session: fixture.session,
      pageDebugId: "canonical-page-debug-id", identityProof: proof,
      imageSha256: createHash("sha256").update(imageBytes).digest("hex"), title: productionArticle.title, body: productionArticle.body, submitted: false
    });

    await expect((adapter as unknown as { productionSubjectAndReadback: (value: typeof ctx, value2: PublishArticleInput) => Promise<unknown> }).productionSubjectAndReadback(ctx, productionArticle)).resolves.toMatchObject({ verified: true, observedExternalCreatorId: "960803317" });
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("accepts a creator home with multiple creator signals despite ordinary login text", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", securityText: "登录 验证码登录 安全验证帮助文案" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板", "创作服务平台"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await adapter.connectAccount(context("account-a"));
    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("logged_in");
  });

  it("fails closed without a canonical Context instead of cold-checking a page that may redirect", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"] });
    let redirected = false;
    (fixture.page as unknown as { waitForTimeout: (milliseconds: number) => Promise<void> }).waitForTimeout = vi.fn(async () => { redirected = true; });
    vi.mocked(fixture.page.url).mockImplementation(() => redirected ? "https://creator.xiaohongshu.com/login" : "https://creator.xiaohongshu.com/new/home");
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("needs_user_action");
  });

  it("ignores hidden verification text on an otherwise logged-in creator home", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", securityText: "验证码登录" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await adapter.connectAccount(context("account-a"));
    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("logged_in");
  });

  it("blocks a visible SMS verification panel", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], blockingSignals: ["visible_sms_verification_panel"] });
    expect(typeof (fixture.page as unknown as { evaluate?: unknown }).evaluate).toBe("function");
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("needs_user_action");
  });

  it("blocks a visible CAPTCHA or slider modal", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { blockingSignals: ["visible_captcha_slider_modal"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("needs_user_action");
  });

  it("reads the stable Xiaohongshu account field instead of guessing an external ID", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountName: "苏州别墅光伏", accountLabelText: "小红书账号：960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"], displayName: "苏州别墅光伏", externalAccountId: "960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await adapter.connectAccount(context("account-a"));
    await expect(adapter.getAccountProfile(context("account-a"))).resolves.toMatchObject({ accountName: "苏州别墅光伏", accountId: "960803317" });
  });

  it("reads the Creator ID from the bounded 小红书账号 label on the existing canonical Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountName: "苏州别墅光伏", accountLabelText: "小红书账号：960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "苏州别墅光伏" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await adapter.connectAccount(context("account-a"));
    const result = await adapter.inspectCanonicalPageRuntime(context("account-a"));

    expect(result).toMatchObject({
      observedCreatorIdRaw: "960803317",
      observedCreatorIdNormalized: "960803317",
      identityObservationStatus: "PASS",
      identityDomDiagnosticMatchCount: 1
    });
    expect(result.identitySourceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "CREATOR_HOME_ACCOUNT_LABEL", rawValue: "960803317", normalizedCreatorId: "960803317", semanticAnchor: "xiaohongshu-account-id-label" })
    ]));
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });

  it("verifies identity on Page A and leaves a different publish-editor Page B usable in the same Context", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountLabelText: "小红书账号：960803317" });
    const identityPage = fixture.page;
    const draftPage = {
      url: vi.fn(() => "https://creator.xiaohongshu.com/publish/publish"),
      isClosed: vi.fn(() => false),
      context: vi.fn(() => fixture.session.context)
    } as unknown as Page;
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    (fixture.manager as unknown as { getContextPages: ReturnType<typeof vi.fn> }).getContextPages = vi.fn(() => [
      { session: fixture.session, page: identityPage, pageIndex: 0, pageDebugId: "identity-page-a", isCanonical: false },
      { session: fixture.session, page: draftPage, pageIndex: 1, pageDebugId: "draft-page-b", isCanonical: true }
    ]);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context("account-a"));

    const result = await adapter.verifyIdentityOnContextPage(context("account-a"));

    expect(result).toMatchObject({ status: "PASS", proof: { browserSessionId: "runtime-session-a", contextId: "context-debug-id", pageId: "identity-page-a", pagePathname: "/new/home", creatorId: "960803317" } });
    expect(identityPage.isClosed).toHaveBeenCalled();
    expect(draftPage.url).toHaveBeenCalled();
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous set of identity-capable Pages", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountLabelText: "小红书账号：960803317" });
    (fixture.session as unknown as { runtimeSessionIdentity: string }).runtimeSessionIdentity = "runtime-session-a";
    const secondIdentityPage = {
      url: vi.fn(() => "https://creator.xiaohongshu.com/new/home"),
      isClosed: vi.fn(() => false),
      context: vi.fn(() => fixture.session.context)
    } as unknown as Page;
    (fixture.manager as unknown as { getContextPages: ReturnType<typeof vi.fn> }).getContextPages = vi.fn(() => [
      { session: fixture.session, page: fixture.page, pageIndex: 0, pageDebugId: "identity-page-a", isCanonical: false },
      { session: fixture.session, page: secondIdentityPage, pageIndex: 1, pageDebugId: "identity-page-b", isCanonical: true }
    ]);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context("account-a"));

    await expect(adapter.verifyIdentityOnContextPage(context("account-a"))).resolves.toEqual({ status: "FAIL", failureCode: "IDENTITY_PAGE_AMBIGUOUS", proof: null });
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
  });

  it("consumes a same-runtime identity proof when the home page has only one generic login signal", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountLabelText: "小红书账号: 960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = {
      ...context("account-a"),
      runtimeIdentityProof: {
        accountId: "account-a",
        platformKey: "xiaohongshu" as const,
        expectedExternalCreatorId: "960803317",
        observedExternalCreatorId: "960803317",
        canonicalContextId: "context-debug-id",
        canonicalPageId: "canonical-page-debug-id",
        verified: true as const
      }
    };

    await adapter.connectAccount(ctx);
    const result = await adapter.preparePublish(ctx, article);

    expect(result).toMatchObject({ prepared: true, titleFilled: true, bodyFilled: true });
    expect(fixture.entryClick).toHaveBeenCalledTimes(1);
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("rejects a same-runtime proof bound to a foreign Page before editor entry", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountLabelText: "小红书账号: 960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = {
      ...context("account-a"),
      runtimeIdentityProof: {
        accountId: "account-a",
        platformKey: "xiaohongshu" as const,
        expectedExternalCreatorId: "960803317",
        observedExternalCreatorId: "960803317",
        canonicalContextId: "context-debug-id",
        canonicalPageId: "foreign-page",
        verified: true as const
      }
    };

    await adapter.connectAccount(ctx);
    await expect(adapter.preparePublish(ctx, article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED", message: expect.stringContaining("runtime identity proof") });
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
  });

  it("uses the same bounded Creator ID reader for getAccountProfile", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountName: "苏州别墅光伏", accountLabelText: "小红书账号: 960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "苏州别墅光伏" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await adapter.connectAccount(context("account-a"));
    await expect(adapter.getAccountProfile(context("account-a"))).resolves.toMatchObject({ accountId: "960803317", accountName: "苏州别墅光伏" });
  });

  it("keeps the owner visible Page through login completion and identity readback", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://www.xiaohongshu.com/user/profile/65abc123", accountName: "小红书账号 A" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "小红书账号 A", externalAccountId: "65abc123" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    expect(fixture.manager.close).not.toHaveBeenCalled();

    await expect(adapter.getAccountProfile(ctx)).resolves.toMatchObject({ accountName: "小红书账号 A", accountId: "65abc123" });
    expect(fixture.open).toHaveBeenCalledTimes(1);
  });

  it("resolves the same active Page when begin and complete use different adapter instances", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    installSharedConnectionLifecycle(fixture);
    const beginAdapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const completeAdapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await beginAdapter.connectAccount(ctx);
    await expect(completeAdapter.completeConnection(ctx)).resolves.toBe("logged_in");
    expect(fixture.manager.getActiveSession?.({ platformKey: "xiaohongshu", accountId: "account-a" })).toBeDefined();
  });

  it("emits sanitized begin and complete diagnostics with identical Page and Context IDs", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onConnectionDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic) } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);

    expect(diagnostics.map((diagnostic) => diagnostic.phase)).toEqual(["BEGIN_LOGIN_PAGE", "COMPLETE_LOGIN_PAGE"]);
    expect(diagnostics[0]).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", activeSessionFound: true, pageUrl: "https://creator.xiaohongshu.com/new/home", pageClosed: false });
    expect(diagnostics[0]?.adapterDebugId).toBe(diagnostics[1]?.adapterDebugId);
    expect(diagnostics[0]?.browserSessionManagerDebugId).toBe(diagnostics[1]?.browserSessionManagerDebugId);
    expect(diagnostics[0]?.contextDebugId).toBe(diagnostics[1]?.contextDebugId);
    expect(diagnostics[0]?.pageDebugId).toBe(diagnostics[1]?.pageDebugId);
    expect(diagnostics.flatMap((diagnostic) => Object.keys(diagnostic))).not.toContain("storageState");
  });

  it("reports ACTIVE_LOGIN_SESSION_NOT_FOUND instead of falling back to stored-session checks", async () => {
    const fixture = setupPage();
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.completeConnection(context("account-a"))).rejects.toThrow(/ACTIVE_LOGIN_SESSION_NOT_FOUND/iu);
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("reads identity before explicit Session persistence and keeps the same Page until release", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "小红书账号 A", externalAccountId: "65abc123" });
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    expect(fixture.manager.save).not.toHaveBeenCalled();
    await expect(adapter.getAccountProfile(ctx)).resolves.toMatchObject({ accountId: "65abc123", accountName: "小红书账号 A" });
    const beforePersist = await adapter.getBrowserSessionEvidence(ctx);
    const lifecycle = adapter as unknown as { persistConnectionSession: (context: AccountContext) => Promise<void> };
    await lifecycle.persistConnectionSession(ctx);
    expect(fixture.manager.save).toHaveBeenCalledTimes(1);
    expect(fixture.manager.close).not.toHaveBeenCalled();
    const afterPersist = await adapter.getBrowserSessionEvidence(ctx);
    expect(afterPersist).toMatchObject({ pageDebugId: beforePersist?.pageDebugId, contextDebugId: beforePersist?.contextDebugId, pageUrl: "https://creator.xiaohongshu.com/new/home" });
    await adapter.releaseConnectionSession?.(ctx);
    expect(fixture.manager.close).toHaveBeenCalledTimes(1);
  });

  it("marks the retained Context authenticated after connection persistence", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    await adapter.persistConnectionSession(ctx);

    expect(fixture.manager.getRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" })).toMatchObject({ state: "AUTHENTICATED" });
  });

  it("releases login operation ownership while retaining the canonical XHS Page and Context", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    await adapter.getAccountProfile(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);

    expect((fixture.page as unknown as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled();
    expect(fixture.manager.close).not.toHaveBeenCalled();
    expect(fixture.manager.getActiveSession?.({ platformKey: "xiaohongshu", accountId: "account-a" })).toBeDefined();
  });

  it("emits sanitized LOGIN_PAGE_RELEASED evidence after retaining the XHS Context", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onConnectionDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.getAccountProfile(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);

    expect(diagnostics.at(-1)).toMatchObject({
      phase: "LOGIN_PAGE_RELEASED",
      platformKey: "xiaohongshu",
      accountId: "account-a",
      pageClosed: false,
      sessionRetainedAfterPageClose: null,
      pageReleaseMode: "RETAINED_ACCOUNT_PAGE"
    });
    expect(diagnostics.flatMap((diagnostic) => Object.keys(diagnostic))).not.toContain("storageState");
  });

  it("runs repeated XHS checkLogin calls on the retained canonical Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.getAccountProfile(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);
    const first = await adapter.checkLogin(ctx);
    const second = await adapter.checkLogin(ctx);

    expect(first).toBe("logged_in");
    expect(second).toBe("logged_in");
    expect(fixture.operationPageDebugIds).toHaveLength(0);
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
    expect(fixture.manager.open).toHaveBeenCalledTimes(1);
    expect(fixture.manager.closeOperationPage).not.toHaveBeenCalled();
    expect(fixture.page.close).not.toHaveBeenCalled();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("keeps the canonical Page identity across repeated XHS checks", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);

    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");
    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");

    expect(fixture.operationPageDebugIds).toHaveLength(0);
    expect(fixture.manager.open).toHaveBeenCalledTimes(1);
    expect(fixture.page.isClosed()).toBe(false);
  });

  it("fails closed when the retained canonical Page is closed", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.persistConnectionSession(ctx);
    await fixture.page.close();

    await expect(adapter.checkLogin(ctx)).resolves.toBe("needs_user_action");
    expect(fixture.operationPageDebugIds).toHaveLength(0);
  });

  it("rejects a canonical Page whose real Page.context() is foreign", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);
    const foreignContext = {} as BrowserSession["context"];
    (fixture.page as unknown as { context: () => BrowserSession["context"] }).context = vi.fn(() => foreignContext);

    await expect(adapter.checkLogin(ctx)).rejects.toThrow(/foreign|ownership|Context/iu);
    expect(fixture.operationPageDebugIds).toHaveLength(0);
  });

  it("serializes one account while allowing a sibling account to proceed", async () => {
    const mutex = new AccountOperationMutex();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = mutex.run("xiaohongshu:account-a", async () => {
      events.push("a:start");
      await firstGate;
      events.push("a:finish");
      return "a";
    });
    const second = mutex.run("xiaohongshu:account-a", async () => {
      events.push("a2:start");
      events.push("a2:finish");
      return "a2";
    });
    const sibling = mutex.run("xiaohongshu:account-b", async () => {
      events.push("b:start");
      events.push("b:finish");
      return "b";
    });

    await sibling;
    expect(events).toEqual(["a:start", "b:start", "b:finish"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["a", "a2"]);
    expect(events).toEqual(["a:start", "b:start", "b:finish", "a:finish", "a2:start", "a2:finish"]);
  });

  it("exposes mutex state while one account operation is active", async () => {
    const mutex = new AccountOperationMutex();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = mutex.run("xiaohongshu:snapshot-account", async () => gate, "checkLogin");

    await vi.waitFor(() => expect(mutex.getState("xiaohongshu:snapshot-account")).toMatchObject({ mutexLocked: true, operationInProgress: true, activeOperation: "checkLogin" }));
    release();
    await running;
    expect(mutex.getState("xiaohongshu:snapshot-account")).toMatchObject({ mutexLocked: false, operationInProgress: false, activeOperation: null });
  });

  it("serializes actual XHS checkLogin calls on the shared canonical Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, loginStabilityWindowMs: 0 });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);

    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const pageWithEvaluate = fixture.page as unknown as { evaluate: (pageFunction: () => unknown) => Promise<unknown> };
    const originalEvaluate = pageWithEvaluate.evaluate;
    pageWithEvaluate.evaluate = vi.fn(async (pageFunction: () => unknown) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push("start");
      if (events.filter((event) => event === "start").length === 1) await firstGate;
      try { return await originalEvaluate(pageFunction); }
      finally { inFlight -= 1; events.push("finish"); }
    });

    const first = adapter.checkLogin(ctx);
    const second = adapter.checkLogin(ctx);
    await vi.waitFor(() => expect(events).toEqual(["start"]));
    expect(events).toEqual(["start"]);
    expect(inFlight).toBe(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["logged_in", "logged_in"]);
    expect(maxInFlight).toBe(1);
    expect(events).toEqual(["start", "finish", "start", "finish"]);
  });

  it("does not cold-open XHS checkLogin from stored credentials", async () => {
    const fixture = setupPage();
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(true);
    vi.mocked(fixture.manager.getActiveSession).mockReturnValue(null);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("needs_user_action");
    expect(fixture.manager.open).not.toHaveBeenCalled();
  });

  it("checks login directly on the canonical Page instead of creating an operation Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", operationPageInitialUrl: "about:blank" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);

    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");
    expect(fixture.operationPages).toHaveLength(0);
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });

  it("emits the actual canonical Page identity for each XHS checkLogin operation", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
    const operations: Array<Record<string, unknown>> = [];
    const evaluations: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      loginStabilityWindowMs: 0,
      onCanonicalPageOperation: (event: Record<string, unknown>) => operations.push(event),
      onLoginEvaluation: (evaluation: Record<string, unknown>) => evaluations.push(evaluation)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.checkLogin(ctx)).resolves.toBe("logged_in");

    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      phase: "STARTED",
      platformKey: "xiaohongshu",
      accountId: "account-a",
      action: "CHECK_LOGIN",
      contextDebugId: "context-debug-id",
      pageDebugId: "canonical-page-debug-id",
      pageRole: "CANONICAL_AUTHENTICATED",
      pageSource: "EXISTING_CANONICAL_PAGE",
      createdNewPage: false,
      pageContextMatchesSession: true,
      browserConnected: true,
      pageClosed: false,
      mutexLocked: true,
      operationInProgress: true
    });
    expect(operations[1]).toMatchObject({
      phase: "COMPLETED",
      finalStatus: "logged_in",
      contextDebugId: "context-debug-id",
      pageDebugId: "canonical-page-debug-id",
      pageRole: "CANONICAL_AUTHENTICATED",
      pageSource: "EXISTING_CANONICAL_PAGE",
      createdNewPage: false,
      pageContextMatchesSession: true,
      browserConnected: true,
      pageClosed: false,
      sanitizedFinalUrl: "https://creator.xiaohongshu.com/new/home"
    });
    expect(operations[0]?.operationId).toEqual(operations[1]?.operationId);
    expect(operations[0]?.operationId).toEqual(expect.any(String));
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.operationId).toBe(operations[0]?.operationId);
    expect(adapter.consumeCompletedCheckLoginOperationId("account-a")).toBe(operations[0]?.operationId);
    expect(adapter.consumeCompletedCheckLoginOperationId("account-a")).toBeNull();
    expect(fixture.page.close).not.toHaveBeenCalled();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("reads XHS profile on the canonical Page after login Page release", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);
    const profile = await adapter.getAccountProfile(ctx);

    expect(profile).toMatchObject({ accountId: "65abc123", accountName: "XHS owner" });
    expect(fixture.operationPageDebugIds).toHaveLength(0);
    expect(fixture.manager.closeOperationPage).not.toHaveBeenCalled();
  });

  it("reads canonical URL and stable Creator identity from the existing Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], externalAccountId: "960803317", displayName: "测试账号", profileUrl: "https://creator.xiaohongshu.com/user/profile/960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await (adapter as unknown as { readCanonicalCreatorIdentity: (value: AccountContext, operationId?: string) => Promise<Record<string, unknown>> }).readCanonicalCreatorIdentity(ctx, "task10v-proof");

    expect(result).toMatchObject({
      canonicalContextId: "context-debug-id",
      canonicalPageId: "canonical-page-debug-id",
      canonicalPageUrl: "https://creator.xiaohongshu.com/new/home",
      domLocationHref: "https://creator.xiaohongshu.com/new/home",
      pageUrlConsistency: "PASS",
      routeClass: "CREATOR_HOME",
      proof: { externalCreatorId: "960803317", stable: true }
    });
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("reports canonical URL disagreement without navigating or opening a replacement Page", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], externalAccountId: "960803317", domLocationHref: "https://creator.xiaohongshu.com/publish/publish" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    (fixture.page.goto as unknown as { mockClear: () => void }).mockClear();
    const result = await (adapter as unknown as { readCanonicalCreatorIdentity: (value: AccountContext, operationId?: string) => Promise<Record<string, unknown>> }).readCanonicalCreatorIdentity(ctx, "task10v-url-mismatch");

    expect(result).toMatchObject({ pageUrlConsistency: "FAIL", proof: { externalCreatorId: "960803317" } });
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("probes the existing canonical Page runtime with bounded identity evidence", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://creator.xiaohongshu.com/user/profile/960803317" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], externalAccountId: "960803317", displayName: "测试账号", profileUrl: "https://creator.xiaohongshu.com/user/profile/960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    (fixture.page.goto as unknown as { mockClear: () => void }).mockClear();

    const result = await (adapter as unknown as {
      inspectCanonicalPageRuntime: (value: AccountContext) => Promise<Record<string, unknown>>
    }).inspectCanonicalPageRuntime(ctx);

    expect(result).toMatchObject({
      probeStatus: "PASS",
      sessionExists: true,
      canonicalContextId: "context-debug-id",
      canonicalPageId: "canonical-page-debug-id",
      probedContextId: "context-debug-id",
      probedPageId: "canonical-page-debug-id",
      playwrightPageUrl: "https://creator.xiaohongshu.com/new/home",
      domLocationHref: "https://creator.xiaohongshu.com/new/home",
      pageUrlConsistency: "PASS",
      domLocationEvaluateStatus: "PASS",
      observedCreatorIdRaw: "960803317",
      observedCreatorIdNormalized: "960803317",
      identityObservationStatus: "PASS"
    });
    expect(result.identitySourceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "PUBLIC_PROFILE_LINK", stableIdentifierPresent: true, sensitiveDataRequired: false, readOnlySafe: true, confidence: "HIGH" })
    ]));
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("ignores query and hash differences when canonical URL origin and pathname match", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home?tab=notes#top" });
    installPageEvidence(fixture, { externalAccountId: "960803317", profileUrl: "https://creator.xiaohongshu.com/user/profile/960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context("account-a"));

    const result = await (adapter as unknown as {
      inspectCanonicalPageRuntime: (value: AccountContext) => Promise<Record<string, unknown>>
    }).inspectCanonicalPageRuntime(context("account-a"));

    expect(result).toMatchObject({ probeStatus: "PASS", pageUrlConsistency: "PASS" });
  });

  it("returns a structured URL consistency failure without navigating", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { domLocationHref: "https://creator.xiaohongshu.com/publish/publish", externalAccountId: "960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context("account-a"));
    (fixture.page.goto as unknown as { mockClear: () => void }).mockClear();

    const result = await (adapter as unknown as {
      inspectCanonicalPageRuntime: (value: AccountContext) => Promise<Record<string, unknown>>
    }).inspectCanonicalPageRuntime(context("account-a"));

    expect(result).toMatchObject({ probeStatus: "FAIL", failureStage: "URL_CONSISTENCY", pageUrlConsistency: "FAIL" });
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("exposes location evaluation failures instead of converting them to incomplete identity evidence", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    const evaluate = vi.fn(async (pageFunction?: () => unknown) => {
      if (typeof pageFunction === "function" && /^\(\)\s*=>\s*location\.href\s*$/u.test(String(pageFunction).trim())) {
        throw Object.assign(new Error("execution context destroyed"), { name: "ExecutionContextDestroyedError" });
      }
      return fixture.phaseSnapshot();
    });
    (fixture.page as unknown as { evaluate: typeof evaluate }).evaluate = evaluate;
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context("account-a"));

    const result = await (adapter as unknown as {
      inspectCanonicalPageRuntime: (value: AccountContext) => Promise<Record<string, unknown>>
    }).inspectCanonicalPageRuntime(context("account-a"));

    expect(result).toMatchObject({
      probeStatus: "FAIL",
      failureStage: "DOM_LOCATION_EVALUATE",
      domLocationEvaluateStatus: "FAIL",
      domLocationEvaluateErrorClass: "ExecutionContextDestroyedError",
      identityObservationStatus: "NOT_RUN"
    });
  });

  it("opens XHS backend on the canonical Page and leaves it open for the owner", async () => {
    const fixture = setupPage();
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);
    const result = await adapter.openBackend(ctx);

    expect(result).toMatchObject({ opened: true, backendUrl: "https://creator.xiaohongshu.com/" });
    expect(fixture.operationPageDebugIds).toHaveLength(0);
    expect(fixture.manager.closeOperationPage).toHaveBeenCalledTimes(0);
  });

  it("only releases the login-only browser after identity persistence is complete", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "小红书账号 A" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.getAccountProfile(ctx);
    const releaseConnectionSession = (adapter as unknown as { releaseConnectionSession?: (releaseContext: AccountContext) => Promise<void> }).releaseConnectionSession;
    expect(releaseConnectionSession).toBeTypeOf("function");
    if (!releaseConnectionSession) throw new Error("releaseConnectionSession is unavailable");
    await releaseConnectionSession.call(adapter, ctx);
    expect(fixture.manager.close).toHaveBeenCalledTimes(1);
  });

  it("reports the exact account-scoped Session and owner-visible Page evidence", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.getBrowserSessionEvidence(ctx)).resolves.toMatchObject({
      platformKey: "xiaohongshu",
      accountId: "account-a",
      sessionKey: "session:xiaohongshu:account-a",
      pageUrl: "https://creator.xiaohongshu.com/new/home",
      pageTitle: "小红书创作服务平台",
      pageCount: 1,
      ownerVisiblePage: true
    });
  });

  it("fails closed with a Session/Page mismatch instead of inspecting an unrelated page", async () => {
    const fixture = setupPage({ pagePresentInContext: false });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.connectAccount(context("account-a"))).rejects.toThrow(/BrowserSession\/Page mismatch/iu);
  });

  it("fails closed when the page exposes only a nickname and no stable external account ID", async () => {
    const fixture = setupPage({ profileHref: null, accountName: "仅昵称" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context("account-a"));
    await expect(adapter.getAccountProfile(context("account-a"))).rejects.toMatchObject({ gateCode: "ACCOUNT_IDENTITY_UNVERIFIED" });
  });

  it("does not cold-check a stored session whose page is on a login page", async () => {
    const fixture = setupPage({ loginPage: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
  });

  it("reports LOGIN_REQUIRED when no stored account session exists", async () => {
    const fixture = setupPage();
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.getAccountProfile(context())).rejects.toMatchObject({ message: expect.stringContaining("LOGIN_REQUIRED") });
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("does not create a new context to check an account with no stored session", async () => {
    const fixture = setupPage();
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("runs the image-post gate in order and never clicks final submit", async () => {
    const fixture = setupPage({ settings: [{ label: "公开范围", required: false, value: "公开" }] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    const result = await adapter.preparePublish(context(), article);
    expect(result).toMatchObject({ prepared: true, requiresUserAction: true, titleFilled: true, bodyFilled: true, response: { imagePostEntry: "verified", imageUploaded: true, titleReadback: true, bodyReadback: true, requiredFieldsStatus: "KNOWN", publishSettingsStatus: "KNOWN", finalSubmitClickCount: 0 } });
    expect(fixture.calls.indexOf("image-post-entry-click")).toBeLessThan(fixture.calls.indexOf("image-set-input-files"));
    expect(fixture.calls.indexOf("image-set-input-files")).toBeLessThan(fixture.calls.indexOf("title-fill"));
    expect(fixture.calls.indexOf("title-fill")).toBeLessThan(fixture.calls.indexOf("body-fill"));
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("uses terminal readiness when the final publish control is only in closed shadow DOM", async () => {
    const fixture = setupPage({ closedShadowFinalSubmit: true, submitCount: 0, settings: [{ label: "公开范围", required: false, value: "公开" }] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());

    const result = await adapter.preparePublish(context(), article);

    expect(result).toMatchObject({
      prepared: true,
      titleFilled: true,
      bodyFilled: true,
      response: { imageUploaded: true, titleReadback: true, bodyReadback: true, finalSubmitClickCount: 0 }
    });
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("runs PRE_UPLOAD discovery before preparePublish mutation and reports post-upload phase failure first", async () => {
    const fixture = setupPage({ titleCount: 0, settings: [{ label: "公开范围", required: false, value: "公开" }] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());

    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("POST_UPLOAD_EDITOR_TIMEOUT"), failureCode: "POST_UPLOAD_EDITOR_TIMEOUT", failureStage: "EDITOR_DISCOVERY" });
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.calls).not.toContain("title-fill");
    expect(fixture.calls).not.toContain("body-fill");
  }, 20_000);

  it("returns a passing PRE_UPLOAD Gate without requiring post-upload controls", async () => {
    const fixture = setupPage({ titleCount: 0 });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());

    await expect(adapter.inspectPublishEditor(context())).resolves.toMatchObject({
      status: "ready",
      editorReached: true,
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: "PASS",
      postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD",
      imageEditorPhase: "IMAGE_POST_PRE_UPLOAD",
      imageEditorPhaseConfidence: "HIGH",
      titleEditorDetected: false,
      bodyEditorDetected: false,
      finalSubmitControlDetected: false
    });
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("rejects a video-only entry instead of navigating to it", async () => {
    const fixture = setupPage({ entryCount: 0, videoEntryCount: 1 });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("IMAGE_POST_ENTRY_NOT_VERIFIED") });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("fails when the image preview never proves upload completion", async () => {
    const fixture = setupPage({ imagePreviewCount: 0 });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "UPLOAD_FAILED", message: expect.stringContaining("IMAGE_UPLOAD_NOT_VERIFIED") });
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("does not treat a global avatar or logo preview as an editor-scoped uploaded image", async () => {
    const fixture = setupPage({ imagePreviewCount: 2, editorScopedImageItemCount: 0 });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());

    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "UPLOAD_FAILED", message: expect.stringContaining("IMAGE_UPLOAD_NOT_VERIFIED") });
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("blocks an upload that remains in a visible loading state", async () => {
    const fixture = setupPage({ imageLoading: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "UPLOAD_FAILED", message: expect.stringContaining("IMAGE_UPLOAD_NOT_VERIFIED") });
  });

  it("stops when the real page reports an image upload failure", async () => {
    const fixture = setupPage({ imageFailed: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "UPLOAD_FAILED", message: expect.stringContaining("IMAGE_UPLOAD_NOT_VERIFIED") });
  });

  it("fails closed for ambiguous title candidates and strict title readback mismatch", async () => {
    const ambiguous = setupPage({ titleCount: 2 });
    const ambiguousAdapter = new XiaohongshuBrowserAdapter({ sessionManager: ambiguous.manager });
    await ambiguousAdapter.connectAccount(context());
    await expect(ambiguousAdapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("TITLE_EDITOR_AMBIGUOUS_POST_UPLOAD"), failureCode: "TITLE_EDITOR_AMBIGUOUS_POST_UPLOAD", failureStage: "EDITOR_DISCOVERY" });

    const mismatch = setupPage({ titleReadback: "other title" });
    const mismatchAdapter = new XiaohongshuBrowserAdapter({ sessionManager: mismatch.manager });
    await mismatchAdapter.connectAccount(context());
    await expect(mismatchAdapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_TITLE_NOT_VERIFIED") });
  });

  it("uses strict body readback and rejects mismatch without substring acceptance", async () => {
    const mismatch = setupPage({ bodyReadback: `${article.body} 额外内容` });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: mismatch.manager });
    await adapter.connectAccount(context());
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({
      code: "CONTENT_REJECTED",
      message: expect.stringContaining("CONTENT_BODY_NOT_VERIFIED"),
      bodyReadback: {
        status: "FAIL",
        expectedHash: expect.stringMatching(/^[0-9A-F]{64}$/),
        actualHash: expect.stringMatching(/^[0-9A-F]{64}$/),
        firstDifferenceIndex: expect.any(Number)
      }
    });
  });

  it("accepts normalized body readback and reports PASS_WITH_NORMALIZATION telemetry", async () => {
    const normalizedArticle = { ...article, body: "第一行\n第二行 文本" };
    const fixture = setupPage({ bodyReadback: "第一行\r\n第二行\u00a0  文本\u200b", settings: [{ label: "公开范围", required: false, value: "公开" }] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());

    const result = await adapter.preparePublish(context(), normalizedArticle);

    expect(result.response).toMatchObject({
      bodyReadback: true,
      bodyReadbackStatus: "PASS_WITH_NORMALIZATION",
      bodyReadbackTelemetry: { status: "PASS_WITH_NORMALIZATION", expectedHash: expect.stringMatching(/^[0-9A-F]{64}$/) }
    });
  });

  it("reports missing required fields and classifies publish settings", async () => {
    const fixture = setupPage({ requiredEmpty: true, settings: [{ label: "公开范围", required: true, value: "" }, { label: "允许下载", required: false, value: "false" }] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "REQUIRED_FIELD_MISSING" });
  });

  it("stops on security verification before opening the image-post editor", async () => {
    const fixture = setupPage({ securityText: "请完成安全验证" });
    installPageEvidence(fixture, { blockingSignals: ["visible_security_modal"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED", message: expect.stringContaining("SECURITY_VERIFICATION_REQUIRED") });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("requires a unique enabled final-submit control and records second confirmation without clicking", async () => {
    const fixture = setupPage({ secondConfirmation: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await adapter.connectAccount(context());
    const result = await adapter.preparePublish(context(), article);
    expect(result.response).toMatchObject({ finalSubmitControl: { verified: true, visible: true, enabled: true, unique: true, secondConfirmation: "present" }, finalSubmitClickCount: 0 });
    expect(fixture.submitClick).not.toHaveBeenCalled();

    const ambiguous = setupPage({ submitCount: 2 });
    const ambiguousAdapter = new XiaohongshuBrowserAdapter({ sessionManager: ambiguous.manager });
    await ambiguousAdapter.connectAccount(context());
    await expect(ambiguousAdapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("FINAL_SUBMIT_CONTROL_AMBIGUOUS_POST_UPLOAD"), failureCode: "FINAL_SUBMIT_CONTROL_AMBIGUOUS_POST_UPLOAD", failureStage: "EDITOR_DISCOVERY" });
  });

  it("inspects the image-text editor on the canonical Page without content mutation", async () => {
    const fixture = setupPage({
      settings: [{ label: "公开范围", required: false, value: "公开" }]
    });
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板", "创作服务平台"] });
    const operations: Array<Record<string, unknown>> = [];
    const entryDiagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onCanonicalPageOperation: (evidence: Record<string, unknown>) => operations.push(evidence),
      onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => entryDiagnostics.push(diagnostic)
    } as never);
    const preparePublish = vi.spyOn(adapter, "preparePublish");
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await (adapter as unknown as { inspectPublishEditor: (context: AccountContext) => Promise<Record<string, unknown>> }).inspectPublishEditor(ctx);

    expect(result).toMatchObject({
      status: "ready",
      editorReached: true,
      authStillValid: true,
      contentType: "IMAGE_POST",
      contentTypeReady: true,
      titleEditorDetected: false,
      bodyEditorDetected: false,
      imageUploadControlDetected: true,
      publishSettingsAreaDetected: false,
      finalSubmitControlDetected: false,
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: "PASS",
      postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD",
      imageEditorPhase: "IMAGE_POST_PRE_UPLOAD",
      imageEditorPhaseConfidence: "HIGH",
      securityVerificationPresent: false,
      loginPagePresent: false,
      needsUserAction: false,
      sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish"
    });
    expect(preparePublish).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
    expect(fixture.calls).not.toContain("title-fill");
    expect(fixture.calls).not.toContain("body-fill");
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({ phase: "STARTED", action: "PRE_SUBMIT_GATE", pageRole: "CANONICAL_AUTHENTICATED", pageSource: "EXISTING_CANONICAL_PAGE", createdNewPage: false, pageContextMatchesSession: true });
    expect(operations[1]).toMatchObject({ phase: "COMPLETED", action: "PRE_SUBMIT_GATE", pageClosed: false, browserConnected: true, finalStatus: "ready" });
    expect(operations[0]?.operationId).toBe(operations[1]?.operationId);
    for (const diagnostic of entryDiagnostics) {
      expect(diagnostic).toEqual(expect.objectContaining({ operationId: expect.any(String), platformKey: "xiaohongshu", accountId: "account-a" }));
    }
    for (const operation of operations) {
      expect(operation).toEqual(expect.objectContaining({ operationId: expect.any(String), platformKey: "xiaohongshu", accountId: "account-a", contextDebugId: "context-debug-id", pageDebugId: "canonical-page-debug-id" }));
    }
    expect(entryDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRE_SUBMIT_GATE_INSPECTION_STARTED", operationId: operations[0]?.operationId, startUrl: "https://creator.xiaohongshu.com/" }),
      expect.objectContaining({ code: "EDITOR_NAVIGATION_HELPER_INVOCATION_STARTED", operationId: operations[0]?.operationId, helper: "navigateToImagePostEditor" }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STARTED", operationId: operations[0]?.operationId, entryMethod: "CLICK_NAVIGATION" }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "CREATOR_HOME_READY", success: true }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "PUBLISH_ENTRY_FOUND", success: true }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "PUBLISH_ENTRY_CLICKED", success: true }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "EDITOR_ROUTE_REACHED", success: true, selectorSignal: "url:/publish/publish" })
    ]));
    expect(entryDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRE_UPLOAD_GATE_INSPECTION_STARTED", expectedPhase: "IMAGE_POST_PRE_UPLOAD" }),
      expect.objectContaining({ code: "PRE_UPLOAD_GATE_RESULT", preSubmitGatePhase: "PRE_UPLOAD", preUploadGateStatus: "PASS", postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD" })
    ]));
  });

  it("classifies a missing publish entry and emits editor-entry diagnostics", async () => {
    const fixture = setupPage({ entryCount: 0 });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({
      status: "editor_not_found",
      failureCode: "PUBLISH_ENTRY_NOT_FOUND",
      failureStage: "PUBLISH_ENTRY_DISCOVERY",
      missingSignal: "publish-entry-semantic-candidate"
    });
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EDITOR_ENTRY_STARTED", operationId: expect.any(String) }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "PUBLISH_ENTRY_FOUND", success: false }),
      expect.objectContaining({ code: "PUBLISH_ENTRY_CANDIDATES_OBSERVED", operationId: expect.any(String), candidateCount: expect.any(Number), candidates: expect.any(Array) }),
      expect.objectContaining({ code: "CREATOR_HOME_READINESS_SAMPLE", operationId: expect.any(String), platformKey: "xiaohongshu", accountId: "account-a" }),
      expect.objectContaining({ code: "CREATOR_HOME_TOPOLOGY_OBSERVED", operationId: expect.any(String), platformKey: "xiaohongshu", accountId: "account-a" }),
      expect.objectContaining({ code: "PUBLISH_SEMANTIC_NODES_OBSERVED", operationId: expect.any(String), platformKey: "xiaohongshu", accountId: "account-a" })
    ]));
    const entryStarted = diagnostics.find((diagnostic) => diagnostic.code === "EDITOR_ENTRY_STARTED");
    const candidatesObserved = diagnostics.find((diagnostic) => diagnostic.code === "PUBLISH_ENTRY_CANDIDATES_OBSERVED");
    expect(candidatesObserved).toMatchObject({ operationId: entryStarted?.operationId, platformKey: "xiaohongshu", accountId: "account-a", sanitizedUrl: "https://creator.xiaohongshu.com/" });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("fails closed on multiple publish-entry candidates without clicking either candidate", async () => {
    const fixture = setupPage({ entryCount: 2 });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.inspectPublishEditor(ctx)).resolves.toMatchObject({ status: "editor_not_found", failureCode: "PUBLISH_ENTRY_AMBIGUOUS", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: "multiple-equivalent-candidates" });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("classifies a click that does not reach the editor route", async () => {
    const fixture = setupPage({ entryNavigationEnabled: false });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({
      status: "needs_user_action",
      failureCode: "EDITOR_ROUTE_NOT_REACHED",
      failureStage: "EDITOR_ROUTE",
      missingSignal: "url:/publish/publish"
    });
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "PUBLISH_ENTRY_CLICKED", success: true }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "EDITOR_ROUTE_REACHED", success: false })
    ]));
    expect(fixture.entryClick).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EDITOR_NAVIGATION_FAILED", operationId: expect.any(String), failureCode: "EDITOR_ROUTE_NOT_REACHED", failureStage: "EDITOR_ROUTE", missingSignal: "url:/publish/publish" })
    ]));
  });

  it("emits inspection and navigation execution markers before preserving an early gate failure", async () => {
    const fixture = setupPage();
    installPageEvidence(fixture, { positiveSignals: [] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const operations: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic),
      onCanonicalPageOperation: (operation: Record<string, unknown>) => operations.push(operation)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({
      status: "needs_user_action",
      failureCode: "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND",
      failureStage: "AUTHENTICATION",
      missingSignal: "creator-authenticated-positive-signal"
    });
    const operationId = operations[0]?.operationId;
    expect(operationId).toEqual(expect.any(String));
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRE_SUBMIT_GATE_INSPECTION_STARTED", operationId, contextDebugId: "context-debug-id", pageDebugId: "canonical-page-debug-id", startUrl: "https://creator.xiaohongshu.com/" }),
      expect.objectContaining({ code: "EDITOR_NAVIGATION_FAILED", operationId, failureCode: "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND", failureStage: "AUTHENTICATION", missingSignal: "creator-authenticated-positive-signal", sanitizedUrlBefore: "https://creator.xiaohongshu.com/", sanitizedUrlAfter: "https://creator.xiaohongshu.com/" })
    ]));
    expect(diagnostics.filter((diagnostic) => diagnostic.code === "EDITOR_NAVIGATION_HELPER_INVOCATION_STARTED")).toHaveLength(0);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === "EDITOR_ENTRY_STARTED")).toHaveLength(0);
    expect(operations[1]).toMatchObject({ operationId, failureCode: "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND", failureStage: "AUTHENTICATION", missingSignal: "creator-authenticated-positive-signal" });
  });

  it("records a correlated lifecycle failure when the canonical Page is unavailable before navigation", async () => {
    const fixture = setupPage();
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({
      status: "needs_user_action",
      authStillValid: false,
      failureCode: "CANONICAL_PAGE_UNAVAILABLE",
      failureStage: "SESSION_PAGE_LIFECYCLE",
      missingSignal: "active-canonical-page"
    });
    const operationId = diagnostics[0]?.operationId;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRE_SUBMIT_GATE_INSPECTION_STARTED", operationId, platformKey: "xiaohongshu", accountId: "account-a", contextDebugId: "unknown-context", pageDebugId: "unknown-page" }),
      expect.objectContaining({ code: "EDITOR_NAVIGATION_FAILED", operationId, failureCode: "CANONICAL_PAGE_UNAVAILABLE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "active-canonical-page" })
    ]));
  });

  it("records a closed canonical Page as a lifecycle failure instead of silently returning a generic result", async () => {
    const fixture = setupPage();
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await fixture.page.close();
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({ failureCode: "CANONICAL_PAGE_UNAVAILABLE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "canonical-page-closed" });
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EDITOR_NAVIGATION_FAILED", failureCode: "CANONICAL_PAGE_UNAVAILABLE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "canonical-page-closed" })
    ]));
  });

  it("records a disconnected BrowserSession before returning without invoking the editor helper", async () => {
    const fixture = setupPage();
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic) } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    vi.mocked((fixture.session.browser as unknown as { isConnected: () => boolean }).isConnected).mockReturnValue(false);
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({ status: "needs_user_action", failureCode: "BROWSER_SESSION_DISCONNECTED", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "browser-disconnected" });
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EDITOR_NAVIGATION_FAILED", failureCode: "BROWSER_SESSION_DISCONNECTED", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "browser-disconnected" })
    ]));
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("returns a structured ownership failure for a canonical Page from a foreign Context", async () => {
    const fixture = setupPage();
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    (fixture.page as unknown as { context: () => BrowserSession["context"] }).context = vi.fn(() => ({ pages: () => [fixture.page] } as unknown as BrowserSession["context"]));
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({ failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "page-context-ownership" });
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EDITOR_NAVIGATION_FAILED", failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "page-context-ownership" })
    ]));
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("keeps the authenticated-page signal fail-closed when runtime state is stale but the Page signal is missing", async () => {
    const fixture = setupPage();
    installPageEvidence(fixture, { positiveSignals: [] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({ status: "needs_user_action", failureCode: "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND", failureStage: "AUTHENTICATION", missingSignal: "creator-authenticated-positive-signal" });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("fails closed when authenticated-page evidence cannot be read before editor navigation", async () => {
    const fixture = setupPage();
    (fixture.page as unknown as { evaluate: () => Promise<unknown> }).evaluate = vi.fn(async () => { throw new Error("page evaluation unavailable"); });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({ status: "needs_user_action", failureCode: "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND", failureStage: "AUTHENTICATION", missingSignal: "creator-authenticated-positive-signal" });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("reuses an already reached image-text editor route without clicking a publish entry again", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/publish/publish", settings: [{ label: "公开范围", required: false, value: "公开" }] });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic) } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await adapter.inspectPublishEditor(ctx);

    expect(result).toMatchObject({ status: "ready", editorReached: true, sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish" });
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "EDITOR_ENTRY_STARTED", entryMethod: "ALREADY_ON_EDITOR" }),
      expect.objectContaining({ code: "EDITOR_ENTRY_STEP", stepName: "EDITOR_ROUTE_REACHED", success: true, navigationTrigger: "DIRECT_GOTO" })
    ]));
  });

  it.each(["https://creator.xiaohongshu.com/", "https://creator.xiaohongshu.com/new/home"]) ("discovers the image-text publish entry from the creator home route %s", async (pageUrl) => {
    const fixture = setupPage({ pageUrl, settings: [{ label: "公开范围", required: false, value: "公开" }] });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.inspectPublishEditor(ctx)).resolves.toMatchObject({ status: "ready", editorReached: true });
    expect(fixture.entryClick).toHaveBeenCalledTimes(1);
  });

  it("reports a publish-entry click failure separately from a route-not-reached result", async () => {
    const fixture = setupPage({ publishEntryClickFails: true });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.inspectPublishEditor(ctx)).resolves.toMatchObject({ status: "needs_user_action", failureCode: "PUBLISH_ENTRY_CLICK_FAILED", failureStage: "PUBLISH_ENTRY_CLICK", missingSignal: expect.stringContaining("/publish/publish") });
    expect(fixture.entryClick).toHaveBeenCalledTimes(1);
  });

  it("runs the controlled post-upload discovery path with exactly one upload and no content mutation", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic) } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await (adapter as unknown as {
      runControlledPostUploadDiscovery: (context: AccountContext, input: { imagePath: string; imageSource: "SAFE_TEST_FIXTURE" }) => Promise<Record<string, unknown>>;
    }).runControlledPostUploadDiscovery(ctx, { imagePath: "C:/fixtures/task10n-safe-test.png", imageSource: "SAFE_TEST_FIXTURE" });

    expect(result).toMatchObject({
      mode: "POST_UPLOAD_DISCOVERY_ONLY",
      status: "PASS",
      preUploadMutationRevalidated: true,
      uploadMutationCount: 1,
      uploadCompletionObserved: true,
      postUploadPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
      postUploadControlsStatus: "READY",
      contentMutationCount: 0,
      finalSubmitCount: 0,
      sameCanonicalPage: true,
      sameContext: true
    });
    expect(fixture.entryClick).toHaveBeenCalledTimes(1);
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.calls).not.toContain("title-fill");
    expect(fixture.calls).not.toContain("body-fill");
    expect(fixture.submitClick).not.toHaveBeenCalled();
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED", mutationType: "IMAGE_UPLOAD_ONLY", selfTestMode: "POST_UPLOAD_DISCOVERY_ONLY" }),
      expect.objectContaining({ code: "IMAGE_UPLOAD_STARTED", action: "IMAGE_UPLOAD_MUTATION" }),
      expect.objectContaining({ code: "IMAGE_UPLOAD_COMPLETED" }),
      expect.objectContaining({ code: "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED" })
    ]));
  });

  it("cancels an explicit native picker marker before controlled editor discovery without retrying upload", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", nativePickerOpenAfterUpload: true });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runControlledPostUploadDiscovery(ctx, { imagePath: "C:/fixtures/task10n-safe-test.png", imageSource: "SAFE_TEST_FIXTURE" });

    expect(result).toMatchObject({ status: "PASS", uploadMutationCount: 1, postUploadControlsStatus: "READY" });
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.nativePickerCancel).toHaveBeenCalledTimes(1);
    expect(fixture.keyboardPress).not.toHaveBeenCalled();
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("fails closed when picker cancellation fails before exploration can mutate content", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", nativePickerOpenAfterUpload: true, nativePickerCancelFails: true });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runPublishFlowExploration(ctx, {
      imagePath: "C:/fixtures/task10n-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: "不应写入",
      body: "不应写入"
    });

    expect(result).toMatchObject({ status: "BLOCKED", blocker: "POST_UPLOAD_EDITOR_TIMEOUT", uploadAttempts: 1, contentMutationCount: 0, finalSubmitCount: 0 });
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.calls).not.toContain("title-fill");
    expect(fixture.calls).not.toContain("body-fill");
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("runs publish-flow exploration through title/body readback and proves final submit without clicking", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onEditorEntryDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic) } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await (adapter as unknown as {
      runPublishFlowExploration: (context: AccountContext, input: { imagePath: string; imageSource: "SAFE_TEST_FIXTURE"; title: string; body: string }) => Promise<Record<string, unknown>>;
    }).runPublishFlowExploration(ctx, {
      imagePath: "C:/fixtures/task10r-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: "小红书发布流程测试-请勿发布",
      body: "自动化发布流程验证，仅用于本地测试，不执行最终发布。"
    });

    expect(result).toMatchObject({
      mode: "XHS_PUBLISH_FLOW_EXPLORATION",
      status: "PASS_READY_FOR_FINAL_SUBMIT",
      readyForFinalSubmit: true,
      uploadMutationCount: 1,
      uploadRetryCount: 0,
      titleReadbackVerified: true,
      bodyReadbackVerified: true,
      finalSubmitCount: 0
    });
    expect(fixture.entryClick).toHaveBeenCalledTimes(1);
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.calls).toContain("title-fill");
    expect(fixture.calls).toContain("body-fill");
    expect(fixture.submitClick).not.toHaveBeenCalled();
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "XHS_PUBLISH_FLOW_TIMELINE" }),
      expect.objectContaining({ code: "XHS_PUBLISH_FLOW_COMPLETED", finalSubmitCount: 0 })
    ]));
  });

  it("lets the fresh-flow branch consume terminal readiness before filling content", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runPublishFlowExploration(ctx, {
      imagePath: "C:/fixtures/task10s-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: "自动化发布测试1｜请忽略",
      body: "GEO Media Publisher 自动发布链路测试。",
      postUploadReadinessStrategy: "TERMINAL_CLASSIFIER"
    });

    expect(result).toMatchObject({
      status: "PASS_READY_FOR_FINAL_SUBMIT",
      readyForFinalSubmit: true,
      uploadMutationCount: 1,
      titleReadbackVerified: true,
      bodyReadbackVerified: true,
      finalSubmitCount: 0
    });
    expect(result.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "POST_UPLOAD_TERMINAL_READINESS", action: "R38_TERMINAL_READINESS_CLASSIFIER", result: "PASS" })
    ]));
    expect(fixture.calls.indexOf("image-set-input-files")).toBeLessThan(fixture.calls.indexOf("title-fill"));
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("fails closed in the fresh-flow branch when terminal readiness is not proven", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", titleCount: 0 });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runPublishFlowExploration(ctx, {
      imagePath: "C:/fixtures/task10s-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: "自动化发布测试1｜请忽略",
      body: "GEO Media Publisher 自动发布链路测试。",
      postUploadReadinessStrategy: "TERMINAL_CLASSIFIER"
    });

    expect(result).toMatchObject({ status: "BLOCKED", finalSubmitCount: 0 });
    expect(result.blocker).toContain("TITLE_CONTROL_MISSING");
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.calls).not.toContain("title-fill");
    expect(fixture.calls).not.toContain("body-fill");
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("autonomously clicks one proven intermediate next action before editing content", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", intermediateAction: true });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runPublishFlowExploration(ctx, {
      imagePath: "C:/fixtures/task10r-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: "小红书发布流程测试-请勿发布",
      body: "自动化发布流程验证，仅用于本地测试，不执行最终发布。"
    });

    expect(result).toMatchObject({ status: "PASS_READY_FOR_FINAL_SUBMIT", intermediateActionClickCount: 1, finalSubmitCount: 0 });
    expect(fixture.calls).toContain("intermediate-next-click");
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("bounds upload retries and derives mutation counters from actual file mutations", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", imageFailed: true });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runPublishFlowExploration(ctx, {
      imagePath: "C:/fixtures/task10r-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: "小红书发布流程测试-请勿发布",
      body: "自动化发布流程验证，仅用于本地测试，不执行最终发布。",
      budgets: { maxUploadAttempts: 2 }
    });

    expect(result).toMatchObject({ status: "BLOCKED", uploadAttempts: 2, uploadMutationCount: 2, uploadRetryCount: 1, finalSubmitCount: 0 });
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(2);
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("reports a disabled final-submit control without clicking it", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", submitEnabled: false });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runPublishFlowExploration(ctx, {
      imagePath: "C:/fixtures/task10r-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: "小红书发布流程测试-请勿发布",
      body: "自动化发布流程验证，仅用于本地测试，不执行最终发布。"
    });

    expect(result).toMatchObject({ status: "BLOCKED", blocker: "FINAL_SUBMIT_NOT_READY", finalSubmit: { status: "DISABLED", visible: true, enabled: false }, finalSubmitCount: 0 });
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("does not upload when PRE_UPLOAD capability is absent", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", fileInputCount: 0 });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runControlledPostUploadDiscovery(ctx, { imagePath: "C:/fixtures/task10n-safe-test.png", imageSource: "SAFE_TEST_FIXTURE" });

    expect(result).toMatchObject({ status: "FAIL", uploadMutationCount: 0, preUploadGateStatus: "FAIL" });
    expect(result.failureCode).toBeTruthy();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
  });

  it("stops after one upload when a post-upload title control is missing", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", titleCount: 0 });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    fixture.manager.setRuntimeAuthState?.({ platformKey: "xiaohongshu", accountId: "account-a" }, "AUTHENTICATED", null);
    const result = await adapter.runControlledPostUploadDiscovery(ctx, { imagePath: "C:/fixtures/task10n-safe-test.png", imageSource: "SAFE_TEST_FIXTURE" });

    expect(result).toMatchObject({ status: "FAIL", uploadMutationCount: 1, uploadCompletionObserved: true, failureCode: "POST_UPLOAD_EDITOR_TIMEOUT" });
    expect(fixture.inputSetFiles).toHaveBeenCalledTimes(1);
    expect(fixture.calls).not.toContain("title-fill");
    expect(fixture.calls).not.toContain("body-fill");
    expect(fixture.submitClick).not.toHaveBeenCalled();
  }, 20_000);

  it("reports missing and failed content-type selection as distinct editor-entry failures", async () => {
    const missing = setupPage({ publishEntryMode: "generic-publish", contentTypeEntryCount: 0 });
    installPageEvidence(missing, { positiveSignals: ["发布笔记", "笔记管理"] });
    const missingAdapter = new XiaohongshuBrowserAdapter({ sessionManager: missing.manager });
    const missingContext = context("account-a");
    await missingAdapter.connectAccount(missingContext);
    await expect(missingAdapter.inspectPublishEditor(missingContext)).resolves.toMatchObject({ failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "content-type:image-text" });

    const failed = setupPage({ publishEntryMode: "generic-publish", contentTypeEntryCount: 1, contentTypeSelectionFails: true });
    installPageEvidence(failed, { positiveSignals: ["发布笔记", "笔记管理"] });
    const failedAdapter = new XiaohongshuBrowserAdapter({ sessionManager: failed.manager });
    const failedContext = context("account-b");
    await failedAdapter.connectAccount(failedContext);
    await expect(failedAdapter.inspectPublishEditor(failedContext)).resolves.toMatchObject({ failureCode: "CONTENT_TYPE_SELECTION_FAILED", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "content-type:image-text" });
  });

  it("distinguishes a route wait timeout from a route that simply never reaches the editor", async () => {
    const timeout = setupPage({ routeWaitTimeout: true, entryNavigationEnabled: false });
    installPageEvidence(timeout, { positiveSignals: ["发布笔记", "笔记管理"] });
    const timeoutAdapter = new XiaohongshuBrowserAdapter({ sessionManager: timeout.manager });
    const timeoutContext = context("account-a");
    await timeoutAdapter.connectAccount(timeoutContext);
    await expect(timeoutAdapter.inspectPublishEditor(timeoutContext)).resolves.toMatchObject({ failureCode: "EDITOR_NAVIGATION_TIMEOUT", failureStage: "EDITOR_NAVIGATION", missingSignal: "editor-route-wait" });

    const notReached = setupPage({ entryNavigationEnabled: false });
    installPageEvidence(notReached, { positiveSignals: ["发布笔记", "笔记管理"] });
    const notReachedAdapter = new XiaohongshuBrowserAdapter({ sessionManager: notReached.manager });
    const notReachedContext = context("account-b");
    await notReachedAdapter.connectAccount(notReachedContext);
    await expect(notReachedAdapter.inspectPublishEditor(notReachedContext)).resolves.toMatchObject({ failureCode: "EDITOR_ROUTE_NOT_REACHED", failureStage: "EDITOR_ROUTE", missingSignal: "url:/publish/publish" });
  });

  it("classifies a candidate inventory exception separately from the final unknown fallback", async () => {
    const fixture = setupPage();
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");
    await adapter.connectAccount(ctx);
    fixture.page.locator = vi.fn(() => { throw new Error("unexpected selector failure"); }) as unknown as Page["locator"];

    await expect(adapter.inspectPublishEditor(ctx)).resolves.toMatchObject({ status: "editor_not_found", failureCode: "PUBLISH_ENTRY_DIAGNOSTIC_FAILED", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: "publish-entry-candidate-inventory" });
  });

  it("returns auth-expired without entering the editor when the canonical Page is on login", async () => {
    const fixture = setupPage({ loginPage: true });
    installSharedConnectionLifecycle(fixture);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await (adapter as unknown as { inspectPublishEditor: (context: AccountContext) => Promise<Record<string, unknown>> }).inspectPublishEditor(ctx);

    expect(result).toMatchObject({ status: "auth_expired", authStillValid: false, loginPagePresent: true, needsUserAction: true });
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(fixture.manager.openOperationPage).not.toHaveBeenCalled();
  });

  it("returns security-verification-required without navigating into the editor", async () => {
    const fixture = setupPage();
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], blockingSignals: ["visible_security_modal"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    const result = await (adapter as unknown as { inspectPublishEditor: (context: AccountContext) => Promise<Record<string, unknown>> }).inspectPublishEditor(ctx);

    expect(result).toMatchObject({ status: "security_verification_required", authStillValid: false, securityVerificationPresent: true, needsUserAction: true });
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
  });

  it("fails the side-effect-free editor gate closed when the canonical Page is unavailable", async () => {
    const fixture = setupPage();
    installSharedConnectionLifecycle(fixture);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await fixture.page.close();
    const result = await (adapter as unknown as { inspectPublishEditor: (context: AccountContext) => Promise<Record<string, unknown>> }).inspectPublishEditor(ctx);

    expect(result).toMatchObject({ status: "needs_user_action", editorReached: false, authStillValid: false, needsUserAction: true });
    expect(fixture.entryClick).not.toHaveBeenCalled();
    expect(fixture.inputSetFiles).not.toHaveBeenCalled();
  });

  it("normalizes only permitted editor differences and requires equality", () => {
    expect(normalizeXiaohongshuEditorText("  A\r\nB\u200b  ")).toBe("A\nB");
    expect(normalizeXiaohongshuEditorText("A B")).not.toBe(normalizeXiaohongshuEditorText("A B extra"));
    expect(classifyXiaohongshuPublishSettings([{ label: "公开范围", required: false, value: "" }])).toBe("KNOWN");
    expect(classifyXiaohongshuPublishSettings([{ label: "", required: false, value: "公开" }])).toBe("UNKNOWN");
  });

  it("routes every account to its own session and never falls back after account A fails", async () => {
    const urls = new Map<string, string>();
    const pages = new Map<string, Page>();
    const sessions = new Map<string, BrowserSession>();
    const pageFor = (accountId: string): Page => {
      let currentUrl = accountId === "account-a" ? "https://creator.xiaohongshu.com/login" : "https://creator.xiaohongshu.com/";
      const ownerContextRef: { value?: BrowserSession["context"] } = {};
      const page = {
        goto: vi.fn(async (url: string) => { if (accountId !== "account-a") currentUrl = url; }),
        url: vi.fn(() => currentUrl),
        locator: vi.fn(() => locator({ innerText: vi.fn(async () => "小红书账号") })),
        context: vi.fn(() => ownerContextRef.value as BrowserSession["context"])
      } as unknown as Page;
      ownerContextRef.value = { pages: () => [page] } as unknown as BrowserSession["context"];
      pages.set(accountId, page);
      return page;
    };
    const manager = {
      hasStoredSession: vi.fn((identity: { accountId: string }) => identity.accountId !== "missing-account"),
      open: vi.fn(async (identity: { accountId: string }) => {
        const page = pageFor(identity.accountId);
        const session = { page, context: page.context(), executionMode: "VISIBLE", headless: false, hasStoredSession: true, sessionIdHash: `session-${identity.accountId}`, browser: { isConnected: () => true } } as unknown as BrowserSession;
        sessions.set(identity.accountId, session);
        urls.set(identity.accountId, page.url());
        return session;
      }),
      getActiveSession: vi.fn((identity: { accountId: string }) => sessions.get(identity.accountId) ?? null),
      openOperationPage: vi.fn(async (identity: { accountId: string }) => {
        const session = sessions.get(identity.accountId);
        if (!session) throw new Error("active session missing");
        return { session, page: session.page, pageDebugId: `operation-${identity.accountId}` };
      }),
      closeOperationPage: vi.fn(async () => undefined),
      setRuntimeAuthState: vi.fn(),
      close: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
      clear: vi.fn(),
      closeAll: vi.fn(async () => undefined)
    } as unknown as BrowserSessionManager;
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: manager });

    await manager.open({ platformKey: "xiaohongshu", accountId: "account-a" }, { userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "CONNECT_ACCOUNT" }, "VISIBLE");
    await manager.open({ platformKey: "xiaohongshu", accountId: "account-b" }, { userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "CONNECT_ACCOUNT" }, "VISIBLE");
    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("expired");
    await expect(adapter.checkLogin(context("account-b"))).resolves.toBe("logged_in");
    await expect(adapter.openBackend(context("missing-account"))).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });

    expect(manager.open).toHaveBeenNthCalledWith(1, { platformKey: "xiaohongshu", accountId: "account-a" }, expect.anything(), "VISIBLE");
    expect(manager.open).toHaveBeenNthCalledWith(2, { platformKey: "xiaohongshu", accountId: "account-b" }, expect.anything(), "VISIBLE");
    expect(manager.open).toHaveBeenCalledTimes(2);
    expect(urls.get("account-a")).toContain("/login");
    expect(urls.get("account-b")).toContain("creator.xiaohongshu.com");
    expect(pages.get("account-a")).not.toBe(pages.get("account-b"));
  });
});
