import { AdapterRegistry, BrowserSessionManager, type BrowserRuntimeEvent, type BrowserSessionLifecycleEvent, type BrowserSessionOperationPageLifecycleEvent } from "@publisher/adapters-core";
import { BaijiahaoBrowserAdapter } from "@publisher/adapters-baijiahao/browser";
import { BilibiliBrowserAdapter } from "@publisher/adapters-bilibili/browser";
import { DouyinOfficialAdapter } from "@publisher/adapters-douyin";
import { FacebookPagesAdapter } from "@publisher/adapters-facebook";
import { KuaishouAdapter } from "@publisher/adapters-kuaishou";
import { SohuBrowserAdapter } from "@publisher/adapters-sohu-media/browser";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { TikTokAdapter } from "@publisher/adapters-tiktok";
import { ToutiaoAdapter } from "@publisher/adapters-toutiao";
import { ToutiaoArticleBrowserAdapter } from "@publisher/adapters-toutiao/browser";
import { WeChatOfficialAdapter } from "@publisher/adapters-wechat";
import { WechatChannelsSemiAutoAdapter } from "@publisher/adapters-wechat-channels/semi-auto";
import { WeiboBrowserAdapter } from "@publisher/adapters-weibo/browser";
import { YouTubeAdapter } from "@publisher/adapters-youtube";
import { XiaohongshuBrowserAdapter } from "@publisher/adapters-xiaohongshu/browser";
import { ZhihuBrowserAdapter } from "@publisher/adapters-zhihu/browser";
import { QqPublicBrowserAdapter } from "@publisher/adapters-qq-public/browser";
import { LiejuBrowserAdapter } from "@publisher/adapters-lieju";
import { CnblogsOfficialApiAdapter } from "@publisher/adapters-cnblogs";
import type { CredentialStore } from "@publisher/security";
import type { Logger } from "@publisher/logger";
import type { BrowserConnectionDiagnostic } from "@publisher/adapters-browser";
import type { XiaohongshuAuthStateDiagnostic, XiaohongshuBrowserAdapterOptions, XiaohongshuCanonicalPageOperationEvidence, XiaohongshuEditorEntryDiagnostic, XiaohongshuLoginEvaluation } from "@publisher/adapters-xiaohongshu/browser";

export function createRuntimeAdapterRegistry(credentials: CredentialStore, includeTestPlatform: boolean, logger?: Logger, browserProfileRootDir?: string, credentialFilePath?: string, productionReceiptFactory?: XiaohongshuBrowserAdapterOptions["productionReceiptFactory"]): AdapterRegistry {
  const registry = new AdapterRegistry();
  const onBrowserRuntimeEvent = (event: BrowserRuntimeEvent): void => {
    if (event.code === "BROWSER_RUNTIME_SELECTED") logger?.info("BROWSER_RUNTIME", event.code, "已选择系统浏览器运行时", event);
    else logger?.warn("BROWSER_RUNTIME", event.code, "未检测到可用系统浏览器", event);
  };
  const onBrowserSessionLifecycle = (event: BrowserSessionLifecycleEvent): void => {
    if (event.platformKey !== "xiaohongshu") return;
    logger?.info("ACCOUNT", `XHS_BROWSER_SESSION_${event.phase}`, "小红书 BrowserSession 生命周期诊断", event as unknown as Record<string, unknown>);
  };
  const onOperationPageLifecycle = (event: BrowserSessionOperationPageLifecycleEvent): void => {
    if (event.platformKey !== "xiaohongshu") return;
    logger?.info("ACCOUNT", event.phase, "小红书 operation Page 生命周期诊断", event as unknown as Record<string, unknown>);
  };
  const browserSessionManager = new BrowserSessionManager(credentials, {
    onRuntimeEvent: onBrowserRuntimeEvent,
    onSessionLifecycle: onBrowserSessionLifecycle,
    onOperationPageLifecycle,
    browserProfileRootDir,
    persistentProfilePlatforms: ["xiaohongshu"],
    persistentProfileCredentialSnapshotPlatforms: [],
    platformPolicies: {
      xiaohongshu: {
        retainContextAfterPageClose: true,
        requireActiveContextForOperations: true
      }
    }
  });
  const beginDiagnostics = new Map<string, BrowserConnectionDiagnostic>();
  const connectionDiagnosticKey = (diagnostic: BrowserConnectionDiagnostic): string => `${diagnostic.platformKey}:${diagnostic.accountId}`;
  const onXiaohongshuConnectionDiagnostic = (diagnostic: BrowserConnectionDiagnostic): void => {
    const key = connectionDiagnosticKey(diagnostic);
    if (diagnostic.phase === "BEGIN_LOGIN_PAGE") beginDiagnostics.set(key, diagnostic);
    const begin = beginDiagnostics.get(key);
    const comparison = diagnostic.phase === "COMPLETE_LOGIN_PAGE" && begin ? {
      sameAdapter: begin.adapterDebugId === diagnostic.adapterDebugId,
      sameManager: begin.browserSessionManagerDebugId === diagnostic.browserSessionManagerDebugId,
      sameContext: Boolean(begin.contextDebugId && begin.contextDebugId === diagnostic.contextDebugId),
      samePage: Boolean(begin.pageDebugId && begin.pageDebugId === diagnostic.pageDebugId)
    } : {};
    logger?.info("ACCOUNT", diagnostic.phase, "小红书 installed-app 登录会话诊断", { ...diagnostic, ...comparison });
  };
  const onXiaohongshuLoginEvaluation = (evaluation: XiaohongshuLoginEvaluation): void => {
    logger?.info("ACCOUNT", evaluation.phase, "小红书 installed-app 当前 Page 登录证据", { ...evaluation });
  };
  const onXiaohongshuCanonicalPageOperation = (evidence: XiaohongshuCanonicalPageOperationEvidence): void => {
    const code = evidence.phase === "STARTED" ? "XHS_CANONICAL_PAGE_OPERATION_STARTED" : "XHS_CANONICAL_PAGE_OPERATION_COMPLETED";
    logger?.info("ACCOUNT", code, "小红书 canonical authenticated Page checkLogin 生命周期诊断", { ...evidence });
  };
  const onXiaohongshuEditorEntryDiagnostic = (diagnostic: XiaohongshuEditorEntryDiagnostic): void => {
    logger?.info("ACCOUNT", diagnostic.code, "小红书 side-effect-free editor entry 诊断", { ...diagnostic });
  };
  const onXiaohongshuAuthStateDiagnostic = (diagnostic: XiaohongshuAuthStateDiagnostic): void => {
    logger?.info("ACCOUNT", "XHS_AUTH_STATE_DIAGNOSTIC", "小红书 auth state 重启诊断", diagnostic as unknown as Record<string, unknown>);
  };
  if (includeTestPlatform) registry.register(new TestPlatformAdapter("success"));
  registry.register(new WeChatOfficialAdapter({ credentialStore: credentials }));
  registry.register(new DouyinOfficialAdapter({ credentialStore: credentials }));
  registry.register(new KuaishouAdapter({ credentialStore: credentials }));
  registry.register(new BilibiliBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new YouTubeAdapter({ credentialStore: credentials }));
  registry.register(new TikTokAdapter({ credentialStore: credentials }));
  registry.register(new ToutiaoAdapter({ credentialStore: credentials }));
  registry.register(new ToutiaoArticleBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new FacebookPagesAdapter({ credentialStore: credentials }));
  registry.register(new WeiboBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new BaijiahaoBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new ZhihuBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new SohuBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new QqPublicBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new LiejuBrowserAdapter({ credentialStore: credentials, sessionManager: browserSessionManager, onBrowserRuntimeEvent }));
  registry.register(new CnblogsOfficialApiAdapter());
  registry.register(new WechatChannelsSemiAutoAdapter());
  registry.register(new XiaohongshuBrowserAdapter({
    credentialStore: credentials,
    sessionManager: browserSessionManager,
    onBrowserRuntimeEvent,
    onConnectionDiagnostic: onXiaohongshuConnectionDiagnostic,
    onLoginEvaluation: onXiaohongshuLoginEvaluation,
    onCanonicalPageOperation: onXiaohongshuCanonicalPageOperation,
    onEditorEntryDiagnostic: onXiaohongshuEditorEntryDiagnostic,
    onAuthStateDiagnostic: onXiaohongshuAuthStateDiagnostic,
    credentialFilePath,
    productionReceiptFactory
  }));
  return registry;
}
