import { describe, expect, it } from "vitest";
import { selectDouyinMusicDiagnosticTarget } from "../apps/desktop/src/main/douyin-music-diagnostic-gate";

const target = {
  configuredAccountId: "account", configuredJobId: "job", requestedAccountId: "account",
  job: { id: "job", accountId: "account", articleId: "article", platformKey: "douyin",
    contentKind: "article", status: "NeedsUserAction" },
  connection: { active: true, creatorId: "123456789", loginGeneration: 2, browserSessionIdHash: "session" },
  intent: { state: "Prepared", finalSubmitCount: 0, submitBoundaryEnteredAt: null },
  record: { status: "Prepared", response: { contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER", musicBinding: { mode: "NONE" } } }
};

describe("opt-in Douyin music diagnostic gate", () => {
  it("requires an exact, prepared, unclaimed image-text Job", () => {
    expect(selectDouyinMusicDiagnosticTarget(target)).toEqual({ accountId: "account", articleId: "article",
      jobId: "job", creatorId: "123456789", loginGeneration: 2, sessionIdHash: "session" });
    expect(() => selectDouyinMusicDiagnosticTarget({ ...target, configuredJobId: null })).toThrow();
    expect(() => selectDouyinMusicDiagnosticTarget({ ...target, requestedAccountId: "other" })).toThrow();
    expect(() => selectDouyinMusicDiagnosticTarget({ ...target, job: { ...target.job, status: "NeedsReconciliation" } })).toThrow();
    expect(() => selectDouyinMusicDiagnosticTarget({ ...target, intent: { ...target.intent, finalSubmitCount: 1 } })).toThrow();
    expect(() => selectDouyinMusicDiagnosticTarget({ ...target, record: null })).toThrow();
  });
});
