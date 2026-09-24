import { describe, expect, it } from "vitest";
import { canonicalSerialize, measureText, normalizeRemoteScheduledAt, validateRemoteSchedule, validateTitle, type ToutiaoArticleSettingsSnapshot } from "./toutiao-article";

describe("Toutiao article domain preparation", () => {
  it("measures JS units and weighted CJK independently and deterministically", () => {
    expect(measureText("中文AB", "js_length")).toBe(4);
    expect(measureText("中文AB", "weighted_cjk")).toBe(3);
    expect(measureText("中文AB", "weighted_cjk")).toBe(3);
    expect(measureText("A😀", "js_length")).toBe(3);
  });

  it("validates configured title bounds without treating a fixture as verified policy", () => {
    const rule = { minimum: 2, maximum: 4, measurement: "weighted_cjk" as const, provenance: "UNVERIFIED_PLATFORM_RULE" as const };
    expect(validateTitle("A", rule)).toContain("TITLE_TOO_SHORT");
    expect(validateTitle("中文ABCDXYZ", rule)).toContain("TITLE_TOO_LONG");
    expect(validateTitle("中文AB", rule)).toEqual([]);
    expect(validateTitle("中文AB", { ...rule, measurement: "js_length" })).toEqual([]);
  });

  it("keeps remote schedule an absolute timestamp and checks a supplied fixture window", () => {
    expect(normalizeRemoteScheduledAt("2026-09-25T15:30:00+08:00")).toBe("2026-09-25T07:30:00.000Z");
    expect(normalizeRemoteScheduledAt("2026-09-25T07:30:00Z")).toBe("2026-09-25T07:30:00.000Z");
    expect(normalizeRemoteScheduledAt("2026-03-08T02:30:00-05:00")).toBe("2026-03-08T07:30:00.000Z");
    expect(() => normalizeRemoteScheduledAt("15:30")).toThrowError(expect.objectContaining({ code: "INVALID_REMOTE_SCHEDULE" }));
    expect(() => normalizeRemoteScheduledAt("2026-02-30T15:30:00+08:00")).toThrowError(expect.objectContaining({ code: "INVALID_REMOTE_SCHEDULE" }));
    const rule = { supportsRemoteScheduling: true, minimumLeadTimeMs: 2 * 60 * 60_000, maximumFutureWindowMs: 7 * 24 * 60 * 60_000, provenance: "UNVERIFIED_PLATFORM_RULE" as const };
    const now = new Date("2026-09-24T07:30:00.000Z");
    expect(validateRemoteSchedule("2026-09-24T08:30:00.000Z", rule, now)).toContain("REMOTE_SCHEDULE_TOO_SOON");
    expect(validateRemoteSchedule("2026-10-02T07:30:00.000Z", rule, now)).toContain("REMOTE_SCHEDULE_TOO_FAR");
    expect(validateRemoteSchedule("2026-09-25T07:30:00.000Z", rule, now)).toEqual([]);
  });

  it("serializes setting keys canonically without changing local execution time", () => {
    const settings: ToutiaoArticleSettingsSnapshot = { version: 1, coverMode: "single", coverImages: ["asset-a"], articleAdType: "platform_default", remoteScheduledAt: "2026-09-25T07:30:00.000Z" };
    expect(canonicalSerialize({ b: 2, a: settings })).toBe(canonicalSerialize({ a: { remoteScheduledAt: settings.remoteScheduledAt, articleAdType: settings.articleAdType, coverImages: ["asset-a"], coverMode: "single", version: 1 }, b: 2 }));
    expect(settings).not.toHaveProperty("scheduledAt");
  });
});
