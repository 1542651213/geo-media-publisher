import { describe, expect, it } from "vitest";
import { stabilizeAfterNativeFilePickerCancel, type PickerCancelFinalControl } from "./picker-cancel-stabilization";

const control = (overrides: Partial<PickerCancelFinalControl> = {}): PickerCancelFinalControl => ({
  status: "NOT_FOUND",
  visible: false,
  enabled: false,
  hitTestValid: false,
  ...overrides
});

describe("picker cancel editor stabilization", () => {
  it("waits for the picker route to clear and discovers a delayed final control", async () => {
    const urls = [
      "https://creator.xiaohongshu.com/publish/publish?openFilePicker=true",
      "https://creator.xiaohongshu.com/publish/publish",
      "https://creator.xiaohongshu.com/publish/publish",
      "https://creator.xiaohongshu.com/publish/publish"
    ];
    let discoveryCount = 0;
    let urlCount = 0;
    const result = await stabilizeAfterNativeFilePickerCancel({
      url: () => urls[Math.min(urlCount++, urls.length - 1)] ?? urls[urls.length - 1]!,
      waitForTimeout: async () => undefined
    }, {
      maxWaitMs: 80,
      retryIntervalMs: 0,
      stableSampleCount: 2,
      discoverFinalControl: async () => {
        discoveryCount += 1;
        return discoveryCount < 3 ? control() : control({ status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true });
      }
    });

    expect(result.finalControlFoundAfterWait).toBe(true);
    expect(result.finalControlDiscoveryRetryCount).toBeGreaterThan(0);
    expect(result.afterPickerCancelUrl).toBe("https://creator.xiaohongshu.com/publish/publish");
  });

  it("fails closed when the final control never appears after picker cancellation", async () => {
    const result = await stabilizeAfterNativeFilePickerCancel({
      url: () => "https://creator.xiaohongshu.com/publish/publish",
      waitForTimeout: async () => undefined
    }, {
      maxWaitMs: 10,
      retryIntervalMs: 0,
      stableSampleCount: 2,
      discoverFinalControl: async () => control()
    });

    expect(result.finalControlFoundAfterWait).toBe(false);
    expect(result.finalControl.status).toBe("NOT_FOUND");
  });

  it("treats transient discovery errors as not found and remains bounded", async () => {
    let attempts = 0;
    const result = await stabilizeAfterNativeFilePickerCancel({
      url: () => "https://creator.xiaohongshu.com/publish/publish",
      waitForTimeout: async () => undefined
    }, {
      maxWaitMs: 10,
      retryIntervalMs: 0,
      stableSampleCount: 2,
      discoverFinalControl: async () => {
        attempts += 1;
        throw new Error("shadow root still committing");
      }
    });

    expect(attempts).toBeGreaterThan(0);
    expect(result.finalControlFoundAfterWait).toBe(false);
    expect(result.finalControl.status).toBe("NOT_FOUND");
  });

  it("clears a stale picker marker after the native dialog is already verified closed", async () => {
    let currentUrl = "https://creator.xiaohongshu.com/publish/publish?openFilePicker=true";
    let clearCalls = 0;
    let discoveryCalls = 0;
    const result = await stabilizeAfterNativeFilePickerCancel({
      url: () => currentUrl,
      waitForTimeout: async () => undefined
    }, {
      maxWaitMs: 80,
      retryIntervalMs: 0,
      stableSampleCount: 2,
      clearOpenPickerMarker: async () => {
        clearCalls += 1;
        currentUrl = "https://creator.xiaohongshu.com/publish/publish";
        return true;
      },
      discoverFinalControl: async () => {
        discoveryCalls += 1;
        return control({ status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true });
      }
    });

    expect(clearCalls).toBe(1);
    expect(discoveryCalls).toBeGreaterThanOrEqual(2);
    expect(result.finalControlFoundAfterWait).toBe(true);
    expect(result.afterPickerCancelUrl).toBe("https://creator.xiaohongshu.com/publish/publish");
  });
});
