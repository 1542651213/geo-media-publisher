import type { AccountContext, PublishArticleInput, PublishResult } from "@publisher/domain";
import type { BrowserPublishAttemptContext } from "@publisher/adapters-core";
import { BrowserAutomationError, type BrowserAutomationAdapterOptions } from "@publisher/adapters-browser";
import { ToutiaoArticleBrowserAdapter } from "./browser";

/** Normal article route. The retained capture/replay experiment is never a fallback. */
export class ToutiaoArticlePublisher extends ToutiaoArticleBrowserAdapter {
  readonly productionTransport = "BrowserNative" as const;
  readonly experimentalTransport = "BrowserAssistedApi" as const;

  constructor(options: BrowserAutomationAdapterOptions & { nativeSubmitEnabled?: boolean }) {
    super(options);
    this.nativeSubmitEnabled = options.nativeSubmitEnabled === true;
  }

  private readonly nativeSubmitEnabled: boolean;

  assertFormalSubmitAvailable(): void {
    if (!this.nativeSubmitEnabled) throw new BrowserAutomationError("USER_ACTION_REQUIRED",
      "Toutiao BrowserNative formal submit is disabled; explicit acceptance/production configuration is required");
  }

  override async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    if (ctx.settings.dryRun === true) return super.publishArticle(ctx, article);
    throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Toutiao requires a persisted prepared editor and submitOnce boundary");
  }

  override async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    this.assertFormalSubmitAvailable();
    if (!attempt.markSubmissionSideEffect) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Durable final-submit boundary is required");
    return super.finalSubmit(ctx, article, attempt);
  }
}
