import { describe, expect, it } from "vitest";
import { douyinPreBoundaryFailure } from "./index";

const base = { platformKey: "douyin", platformFinalSubmitPath: true, sideEffectTriggered: false,
  intent: { state: "Prepared", finalSubmitCount: 0, submitBoundaryEnteredAt: null, submissionAttemptId: null } };

describe("Douyin final boundary classification", () => {
  it.each(["MANAGEMENT_STATES_UNVERIFIED", "BODY_MISMATCH", "MUSIC_READBACK_MISMATCH"])(
    "keeps %s before claim out of reconciliation", () => expect(douyinPreBoundaryFailure(base)).toBe(true));
  it("keeps a reserved attempt, claim, and other platforms conservative", () => {
    expect(douyinPreBoundaryFailure({ ...base, intent: { ...base.intent, submissionAttemptId: "reserved" } })).toBe(false);
    expect(douyinPreBoundaryFailure({ ...base, sideEffectTriggered: true,
      intent: { ...base.intent, finalSubmitCount: 1, submitBoundaryEnteredAt: "2026-09-26T00:00:00Z", submissionAttemptId: "claimed" } })).toBe(false);
    expect(douyinPreBoundaryFailure({ ...base, platformKey: "toutiao" })).toBe(false);
  });
});
