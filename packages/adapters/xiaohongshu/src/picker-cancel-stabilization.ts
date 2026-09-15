export interface PickerCancelFinalControl {
  status: string;
  visible: boolean;
  enabled: boolean;
  hitTestValid: boolean;
  label?: string;
}

export interface PickerCancelStabilizationPage {
  url(): string | Promise<string>;
  waitForTimeout?: (timeout: number) => Promise<void>;
}

export interface PickerCancelStabilizationOptions {
  maxWaitMs?: number;
  retryIntervalMs?: number;
  stableSampleCount?: number;
  /**
   * Clears only the stale browser-side picker route marker after the native
   * dialog has already been verified closed. This is intentionally optional;
   * without a verified clear the bounded loop remains fail-closed.
   */
  clearOpenPickerMarker?: () => boolean | Promise<boolean>;
  discoverFinalControl: () => Promise<PickerCancelFinalControl>;
}

export interface PickerCancelStabilizationResult {
  afterPickerCancelUrl: string;
  afterPickerCancelWaitMs: number;
  finalControlDiscoveryRetryCount: number;
  finalControlFoundAfterWait: boolean;
  finalControl: PickerCancelFinalControl;
}

const DEFAULT_MAX_WAIT_MS = 10_000;
const MAX_WAIT_MS = 15_000;
const DEFAULT_RETRY_INTERVAL_MS = 80;

async function waitForRetry(page: PickerCancelStabilizationPage, timeout: number): Promise<void> {
  if (timeout <= 0) return;
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(timeout);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, timeout));
}

function hasOpenPickerMarker(url: string): boolean {
  try {
    return new URL(url).searchParams.get("openFilePicker") === "true";
  } catch {
    return url.includes("openFilePicker=true");
  }
}

function controlFingerprint(control: PickerCancelFinalControl): string {
  return JSON.stringify({
    status: control.status,
    visible: control.visible,
    enabled: control.enabled,
    hitTestValid: control.hitTestValid,
    label: control.label ?? null
  });
}

function isUsableFinalControl(control: PickerCancelFinalControl): boolean {
  return control.status === "FOUND_UNIQUE"
    && control.visible
    && control.enabled
    && control.hitTestValid;
}

/**
 * Waits for the picker marker to clear and for the read-only final surface to
 * remain stable. The callback is intentionally discovery-only: it cannot
 * click, upload, navigate, or mutate editor content.
 */
export async function stabilizeAfterNativeFilePickerCancel(
  page: PickerCancelStabilizationPage,
  options: PickerCancelStabilizationOptions
): Promise<PickerCancelStabilizationResult> {
  const maxWaitMs = Math.max(0, Math.min(MAX_WAIT_MS, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS));
  const retryIntervalMs = Math.max(0, options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS);
  const stableSampleCount = Math.max(2, options.stableSampleCount ?? 2);
  const startedAt = Date.now();
  let retryCount = 0;
  let stableCount = 0;
  let previousFingerprint = "";
  let markerClearAttempted = false;
  let lastUrl = "";
  let lastControl: PickerCancelFinalControl = {
    status: "NOT_FOUND",
    visible: false,
    enabled: false,
    hitTestValid: false
  };

  while (Date.now() - startedAt <= maxWaitMs) {
    try {
      lastUrl = await page.url();
    } catch {
      lastUrl = "";
    }
    if (hasOpenPickerMarker(lastUrl)) {
      if (!markerClearAttempted && typeof options.clearOpenPickerMarker === "function") {
        markerClearAttempted = true;
        try {
          const cleared = await options.clearOpenPickerMarker();
          if (cleared) {
            try {
              lastUrl = await page.url();
            } catch {
              // Keep the last safe URL if the page closes during the clear.
            }
            if (!hasOpenPickerMarker(lastUrl)) continue;
          }
        } catch {
          // Keep the route marker as a fail-closed signal when the page-side
          // cleanup cannot be verified.
        }
      }
      stableCount = 0;
      previousFingerprint = "";
      await waitForRetry(page, retryIntervalMs);
      continue;
    }

    try {
      lastControl = await options.discoverFinalControl();
    } catch {
      // A closed-shadow surface can be temporarily unavailable while React
      // commits the post-cancel editor state. Treat that sample as not found
      // and keep the bounded, read-only retry loop fail-closed.
      lastControl = {
        status: "NOT_FOUND",
        visible: false,
        enabled: false,
        hitTestValid: false
      };
    }
    const fingerprint = controlFingerprint(lastControl);
    stableCount = fingerprint === previousFingerprint ? stableCount + 1 : 1;
    previousFingerprint = fingerprint;
    if (isUsableFinalControl(lastControl) && stableCount >= stableSampleCount) {
      return {
        afterPickerCancelUrl: lastUrl,
        afterPickerCancelWaitMs: Math.max(0, Date.now() - startedAt),
        finalControlDiscoveryRetryCount: retryCount,
        finalControlFoundAfterWait: true,
        finalControl: lastControl
      };
    }
    if (Date.now() - startedAt >= maxWaitMs) break;
    retryCount += 1;
    await waitForRetry(page, retryIntervalMs);
  }

  try {
    lastUrl = await page.url();
  } catch {
    // Keep the last safe URL observed during the bounded wait.
  }
  return {
    afterPickerCancelUrl: lastUrl,
    afterPickerCancelWaitMs: Math.max(0, Date.now() - startedAt),
    finalControlDiscoveryRetryCount: retryCount,
    finalControlFoundAfterWait: false,
    finalControl: lastControl
  };
}
