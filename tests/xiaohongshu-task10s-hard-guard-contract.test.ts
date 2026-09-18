import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browserSource = readFileSync("packages/adapters/xiaohongshu/src/browser.ts", "utf8");
const coreSource = readFileSync("packages/adapters/core/src/one-shot-publication.ts", "utf8");
const publisherSource = readFileSync("packages/publisher/src/index.ts", "utf8");

describe("Task10S XHS final-submit hard guard", () => {
  it("keeps one-shot authorization and bounded publication markers in source", () => {
    expect(coreSource).toContain("OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH");
    expect(coreSource).toContain("ONE_SHOT_REAL_PUBLISH_ACCEPTANCE");
    expect(coreSource).toContain("FINAL_SUBMIT_ALREADY_USED");
    expect(coreSource).toContain("publicationTransactionCount");
    expect(coreSource).toContain("finalSubmitRetryCount");
    expect(coreSource).toContain("MAX_PUBLICATION_TRANSACTIONS");
    expect(coreSource).toContain("MAX_FINAL_SUBMIT_ATTEMPTS");
    expect(coreSource).toContain("MAX_PUBLICATION_COMMIT_ACTIONS");
    expect(browserSource).toContain("oneShotPublicationGuard");
    expect(browserSource).toContain("runOneShotRealPublishAcceptance");
    expect(browserSource).toContain("OWNER_FINAL_SUBMIT_AUTHORIZATION");
    expect(browserSource).toContain("PUBLICATION_RECONCILED");
    expect(publisherSource).toContain("ONE_SHOT_FINAL_SUBMIT_PATH_REQUIRED");
    expect(publisherSource).toContain("ONE_SHOT_AUTHORIZATION_REQUIRED");
  });

  it("contains no XHS final-submit bypass API", () => {
    expect(browserSource).not.toMatch(/\.evaluate\([^)]*(?:form\s*\.\s*submit|requestSubmit|dispatchEvent)[^)]*\)/iu);
    expect(browserSource).not.toMatch(/page\.(?:keyboard\.(?:press|type)|press)\([^)]*(?:Enter|Control|Command)[^)]*\)/iu);
    expect(browserSource).not.toMatch(/fetch\([^)]*(?:publish|submit)[^)]*\)/iu);
  });

  it("preserves Task10R read-only final-submit behavior", () => {
    expect(browserSource).toContain('finalSubmitCount: 0');
    expect(browserSource).toContain('"READ_ONLY_CONTROL_DISCOVERY"');
    expect(browserSource).toContain('selfTestMode: "XHS_PUBLISH_FLOW_EXPLORATION"');
  });
});
