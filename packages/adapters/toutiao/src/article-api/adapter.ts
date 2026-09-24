import type { PlatformAdapter } from "@publisher/adapters-core";
import { ToutiaoPreparationError, validateTitle, type AccountContext, type AdapterManifest, type LoginSession, type LoginStatus, type PlatformCapabilities, type PublishArticleInput, type PublishResult, type ValidationResult } from "@publisher/domain";
import { prepareToutiaoArticlePayload, type ToutiaoArticlePreparationInput } from "./payload";

/** Offline-only article adapter. No credential, request, upload or submit implementation exists in R1-B. */
export class ToutiaoArticleApiAdapter implements PlatformAdapter {
  readonly platformKey = "toutiao";
  readonly manifest: AdapterManifest = {
    platformKey: "toutiao", displayName: "Toutiao article Web API preparation", category: "图文", version: "0.1.0-r1b",
    adapterStatus: "not_implemented", authStrategy: "Unsupported", callbackStrategy: "ManualCodeCallback",
    status: "WaitingForUser", researchStatus: "partial", transport: "web_api", integrationMode: "API",
    supportsArticle: true, supportsVideo: false, officialWebsite: "https://mp.toutiao.com/", credentialSchema: [],
    officialSources: ["https://mp.toutiao.com/"], blockingReason: "R1-B prepares content offline; authentication and submit are not implemented"
  };

  getCapabilities(): PlatformCapabilities {
    return {
      article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: false,
      scheduledPublish: true, draft: false, markdown: false, richText: true, maxTitleLength: 0, maxImageCount: 0,
      contentTransport: "ARTICLE_WEB_API",
      titleConstraint: { measurement: "weighted_cjk", provenance: "UNVERIFIED_PLATFORM_RULE" },
      remoteScheduleConstraint: { supportsRemoteScheduling: true, provenance: "UNVERIFIED_PLATFORM_RULE" },
      coverConstraint: { supportedModes: ["auto", "none", "single", "multiple"], provenance: "UNVERIFIED_PLATFORM_RULE" }
    };
  }
  getCredentialSchema() { return []; }
  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> { return "unknown"; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { throw new ToutiaoPreparationError("ARTICLE_API_SUBMIT_NOT_IMPLEMENTED"); }
  assertFormalSubmitAvailable(): never { throw new ToutiaoPreparationError("ARTICLE_API_SUBMIT_NOT_IMPLEMENTED"); }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { throw new ToutiaoPreparationError("ARTICLE_API_SUBMIT_NOT_IMPLEMENTED"); }
  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors = validateTitle(article.title, { minimum: 1, measurement: "weighted_cjk", provenance: "UNVERIFIED_PLATFORM_RULE" });
    return { valid: errors.length === 0, errors, warnings: ["Toutiao article Web API limits remain unverified"] };
  }
  prepareArticle(input: ToutiaoArticlePreparationInput) { return prepareToutiaoArticlePayload(input); }
}
