import { describe, expect, it } from "vitest";
import { assertKangyiAccountScope, assertKangyiContentIdentity, assertKangyiJobIdentity, assertKangyiPhase2Authorization, assertKangyiPilotBudget, assertKangyiPublishAccepted, assertKangyiPublishIdentity, assertKangyiPublicVerification, assertKangyiStopCondition, assertKangyiValidationIdentity } from "./kangyi-phase2-gates";

const authorization = () => ({ enabled: true as const, authorizationId: "owner-auth-1", accountId: "account-1", siteId: "kangyi", environment: "staging" as const, writesEnabled: true as const, capabilitiesHttpStatus: 200, protocolVersion: "2", contentKinds: ["article", "case"] });

describe("Kangyi Phase 2 fail-closed gates", () => {
  it.each(["huiquan", "shupai"] as const)("binds %s authorization to the exact staging site", (siteId) => {
    expect(() => assertKangyiPhase2Authorization({ ...authorization(), siteId }, siteId)).not.toThrow();
    expect(() => assertKangyiPhase2Authorization({ ...authorization(), siteId }, "kangyi")).toThrow("KANGYI_PHASE2_SCOPE_MISMATCH");
    expect(() => assertKangyiPhase2Authorization({ ...authorization(), siteId, environment: "production" }, siteId)).toThrow("KANGYI_PHASE2_SCOPE_MISMATCH");
    expect(() => assertKangyiAccountScope({ accountId: "account-1", expectedAccountId: "account-1", siteId, environment: "staging", writesEnabled: true }, siteId)).not.toThrow();
  });
  it("keeps the owner gate closed unless an explicit authorization is supplied", () => {
    expect(() => assertKangyiPhase2Authorization({ ...authorization(), enabled: false, authorizationId: "" })).toThrow("KANGYI_PHASE2_OWNER_AUTH_REQUIRED");
    expect(() => assertKangyiPhase2Authorization({ ...authorization(), capabilitiesHttpStatus: 401 })).toThrow("KANGYI_PHASE2_CAPABILITIES_NOT_VERIFIED");
    expect(() => assertKangyiPhase2Authorization(authorization())).not.toThrow();
  });

  it("binds execution to the verified staging account and capabilities", () => {
    expect(() => assertKangyiAccountScope({ accountId: "account-1", expectedAccountId: "account-1", siteId: "kangyi", environment: "staging", writesEnabled: true })).not.toThrow();
    expect(() => assertKangyiAccountScope({ accountId: "account-1", expectedAccountId: "account-2", siteId: "kangyi", environment: "staging", writesEnabled: true })).toThrow("KANGYI_ACCOUNT_SCOPE_MISMATCH");
    expect(() => assertKangyiAccountScope({ accountId: "account-1", expectedAccountId: "account-1", siteId: "other", environment: "staging", writesEnabled: true })).toThrow("KANGYI_ACCOUNT_SCOPE_MISMATCH");
    expect(() => assertKangyiAccountScope({ accountId: "account-1", expectedAccountId: "account-1", siteId: "kangyi", environment: "staging", writesEnabled: false })).toThrow("KANGYI_PHASE2_WRITES_DISABLED");
  });

  it("enforces the one-article staging pilot budget", () => {
    expect(() => assertKangyiPilotBudget({ articleCount: 1, imageCount: 1, logicalCreateCount: 1, logicalDraftCount: 1, logicalValidateCount: 1, logicalPublishCount: 1 })).not.toThrow();
    expect(() => assertKangyiPilotBudget({ articleCount: 2, imageCount: 1, logicalCreateCount: 1, logicalDraftCount: 0, logicalValidateCount: 1, logicalPublishCount: 1 })).toThrow("KANGYI_PILOT_ARTICLE_LIMIT");
    expect(() => assertKangyiPilotBudget({ articleCount: 1, imageCount: 1, logicalCreateCount: 1, logicalDraftCount: 0, logicalValidateCount: 1, logicalPublishCount: 2 })).toThrow("KANGYI_PILOT_PUBLISH_LIMIT");
  });

  it("blocks unsafe CMS outcomes", () => {
    expect(() => assertKangyiPublishAccepted(200)).toThrow("KANGYI_PUBLISH_MUST_RETURN_202");
    expect(() => assertKangyiPublishAccepted(202)).not.toThrow();
    expect(() => assertKangyiStopCondition("MEDIA_HASH_MISMATCH", false)).toThrow("KANGYI_STOP_MEDIA_HASH_MISMATCH");
    expect(() => assertKangyiStopCondition("MEDIA_HASH_MISMATCH", true)).not.toThrow();
  });

  it("rejects missing or stale CMS identities and mismatched public verification", () => {
    expect(() => assertKangyiContentIdentity({ contentId: "c1", revisionId: "r1", rowVersion: 1, contentHash: "h1" })).not.toThrow();
    expect(() => assertKangyiContentIdentity({ contentId: "", revisionId: "r1", rowVersion: 1, contentHash: "h1" })).toThrow("KANGYI_CONTENT_IDENTITY_MISSING");
    expect(() => assertKangyiContentIdentity({ contentId: "c1", revisionId: "r1", rowVersion: 0, contentHash: "h1" })).toThrow("KANGYI_CONTENT_IDENTITY_MISSING");
    expect(() => assertKangyiValidationIdentity({ valid: true, revisionId: "r1", contentHash: "h1" }, { revisionId: "r1", contentHash: "h1" })).not.toThrow();
    expect(() => assertKangyiValidationIdentity({ valid: false, revisionId: "r1", contentHash: "h1" }, { revisionId: "r1", contentHash: "h1" })).toThrow("KANGYI_VALIDATION_FAILED");
    expect(() => assertKangyiValidationIdentity({ valid: true, revisionId: "other", contentHash: "h1" }, { revisionId: "r1", contentHash: "h1" })).toThrow("KANGYI_VALIDATION_IDENTITY_MISMATCH");
    expect(() => assertKangyiPublishIdentity({ httpStatus: 202, jobId: "j1", contentId: "c1", revisionId: "r1", rowVersion: 1, contentHash: "h1" }, { contentId: "c1", revisionId: "r1", rowVersion: 1, contentHash: "h1" })).not.toThrow();
    expect(() => assertKangyiPublishIdentity({ httpStatus: 202, jobId: "j1", contentId: "c1", revisionId: "r2", rowVersion: 1, contentHash: "h1" }, { contentId: "c1", revisionId: "r1", rowVersion: 1, contentHash: "h1" })).toThrow("KANGYI_PUBLISH_IDENTITY_MISMATCH");
    expect(() => assertKangyiJobIdentity({ jobId: "j1" }, "j1")).not.toThrow();
    expect(() => assertKangyiJobIdentity({ jobId: "j2" }, "j1")).toThrow("KANGYI_CMS_JOB_ID_MISMATCH");
    expect(() => assertKangyiPublicVerification({ ok: true, contentId: "c1", publicUrl: "https://www.kangyihb.com/a" }, { contentId: "c1", publicUrl: "https://www.kangyihb.com/a" })).not.toThrow();
    expect(() => assertKangyiPublicVerification({ ok: true, contentId: "c2", publicUrl: "https://www.kangyihb.com/a" }, { contentId: "c1", publicUrl: "https://www.kangyihb.com/a" })).toThrow("PUBLIC_READBACK_MISMATCH");
  });
});
