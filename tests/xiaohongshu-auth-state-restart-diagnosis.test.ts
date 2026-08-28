import { describe, expect, it } from "vitest";
import { parseXhsAuthStateDiagnostics, selectLatestOwnerDiagnostics } from "../scripts/v143-xiaohongshu-auth-state-restart-diagnosis.helpers";

describe("Xiaohongshu auth-state restart diagnosis runner selection", () => {
  it("selects the latest coherent live-login and before-close pair", () => {
    const event = (timestamp: string, phase: string, marker: string, stableObservationPassed?: boolean) => JSON.stringify({ timestamp, code: "XHS_AUTH_STATE_DIAGNOSTIC", context: { phase, platformKey: "xiaohongshu", accountId: "a", profilePath: "C:/p", marker, stableObservationPassed } });
    const parsed = parseXhsAuthStateDiagnostics([
      event("2026-08-28T00:00:00.000Z", "LIVE_LOGIN_BEFORE_CLOSE", "old-live", true),
      event("2026-08-28T00:00:01.000Z", "AUTH_STATE_BEFORE_CLOSE", "old-before"),
      event("2026-08-28T01:00:00.000Z", "LIVE_LOGIN_BEFORE_CLOSE", "new-live", true),
      event("2026-08-28T01:00:01.000Z", "AUTH_STATE_BEFORE_CLOSE", "new-before")
    ].join("\n"), "a", "C:/p");

    const pair = selectLatestOwnerDiagnostics(parsed);
    expect(pair?.[0].context.marker).toBe("new-live");
    expect(pair?.[1].context.marker).toBe("new-before");
  });
});
