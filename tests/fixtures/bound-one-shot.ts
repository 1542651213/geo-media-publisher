import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type OneShotPublicationAuthorization, type XhsContextIdentityAttestation } from "@publisher/domain";
import type { AppRepository } from "@publisher/db";

/** Explicit synthetic one-shot fixture. Never used by ordinary publication tests. */
export function boundOneShot(repository: AppRepository) {
 const account = repository.createAccount({ platformKey: "xiaohongshu", name: "Bound mock account" });
 repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", externalAccountId: "synthetic-creator", browserSessionId: "mock-session" });
 const bytes = Buffer.from("synthetic-image-bytes"); const filePath = join(dirname(repository.db.name), "synthetic.png"); writeFileSync(filePath, bytes);
 const image = repository.createImageAsset({ brandId: null, name: "synthetic", filePath, originalFileName: "synthetic.png", mimeType: "image/png", size: bytes.length });
 const captured = repository.contentSnapshots.capture({ purpose: "ONE_SHOT_ACCEPTANCE", platformKey: "xiaohongshu", accountId: account.id, creatorId: "synthetic-creator", title: "Synthetic title", body: "Synthetic body", imageIds: [image.id] });
 const s = captured.snapshot;
 repository.createOneShotContentBinding({ contentBindingId: s.id, platformKey: s.platformKey, accountId: s.accountId, creatorId: s.creatorId!, titleCanonical: s.canonicalTitle, bodyCanonical: s.canonicalBody, titleSha256: s.canonicalTitleSha256, bodySha256: s.canonicalBodySha256, imageAssetId: image.id, imageSha256: createHash("sha256").update(bytes).digest("hex") });
 const run = repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L5_PUBLISH", contentBindingId: s.id });
 s.operationId = run.testRunId; repository.contentSnapshots.save(captured);
 const authorization: OneShotPublicationAuthorization = { authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, state: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId: account.id as OneShotPublicationAuthorization["accountId"], operationId: run.testRunId, contentBindingId: s.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, publicationTransactionCount: 0, publicationCommitActionCount: 0, finalSubmitAttemptCount: 0, finalSubmitRetryCount: 0, finalSubmitActionStarted: false, finalSubmitActionCompleted: false, consumedAt: null };
 repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, authorization);
 const job = repository.createPlatformSelfTestPublishJob({ testRunId: run.testRunId, title: s.rawTitle, body: s.rawBody, dryRun: false, contentBindingId: s.id, selectedImageAssetId: image.id });
 repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformKey: account.platformKey, articleId: job.articleId, success: false, dryRun: false, status: "Prepared", response: { synthetic: true }, publishedUrl: null, publishedExternalId: null });
 repository.confirmJob(job.id, false);
 const subject: XhsContextIdentityAttestation = { accountId: account.id, platformKey: "xiaohongshu", expectedExternalCreatorId: "synthetic-creator", observedExternalCreatorId: "synthetic-creator", externalAccountId: "synthetic-creator", browserSessionIdentity: "mock-session", browserContextIdentity: "mock-context", sourcePageIdentity: "mock-page", sourceOrigin: "https://creator.xiaohongshu.com", sourcePathname: "/publish/publish", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(), verified: true };
 return { account, run, job, authorization, subject };
}
