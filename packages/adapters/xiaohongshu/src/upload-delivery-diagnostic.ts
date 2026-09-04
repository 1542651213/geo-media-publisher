import type { ElementHandle, Locator } from "playwright-core";

export type XiaohongshuUploadFixtureMatch = "YES" | "NO" | "NOT_REQUIRED";

export interface XiaohongshuUploadFileExpectation {
  name: string;
  size: number;
  type: string;
}

export interface XiaohongshuUploadInputFingerprint {
  tagName: string;
  type: string;
  accept: string;
  multiple: boolean;
  disabled: boolean;
  connected: boolean;
  classNameSafe: string;
}

export interface XiaohongshuUploadFileMetadata {
  name: string | null;
  size: number | null;
  type: string | null;
  lastModified: number | null;
}

export interface XiaohongshuUploadFileReadback {
  filesLength: number;
  files: readonly XiaohongshuUploadFileMetadata[];
}

export interface XiaohongshuUploadInputImmediateReadback {
  status: "PASS" | "FAIL";
  failureCode: "FILE_INPUT_HANDLE_UNAVAILABLE" | "INPUT_NOT_USABLE" | "SET_INPUT_FILES_FAILED" | "INPUT_DETACHED_DURING_READBACK" | "FILE_INPUT_READBACK_MISMATCH" | null;
  fingerprint: XiaohongshuUploadInputFingerprint | null;
  readback: XiaohongshuUploadFileReadback;
  expectedFixtureMatch: XiaohongshuUploadFixtureMatch;
}

const EMPTY_READBACK: XiaohongshuUploadFileReadback = { filesLength: 0, files: [] };

function failed(failureCode: XiaohongshuUploadInputImmediateReadback["failureCode"], fingerprint: XiaohongshuUploadInputFingerprint | null = null, readback: XiaohongshuUploadFileReadback = EMPTY_READBACK, expectedFixtureMatch: XiaohongshuUploadFixtureMatch = "NO"): XiaohongshuUploadInputImmediateReadback {
  return { status: "FAIL", failureCode, fingerprint, readback, expectedFixtureMatch };
}

function matchesExpectedFile(readback: XiaohongshuUploadFileReadback, expected: XiaohongshuUploadFileExpectation | undefined): boolean {
  if (!expected || readback.filesLength !== 1 || readback.files.length !== 1) return false;
  const file = readback.files[0];
  return file?.name === expected.name && file.size === expected.size && file.type === expected.type;
}

function safeReadback(readback: XiaohongshuUploadFileReadback, expected: XiaohongshuUploadFileExpectation | undefined): XiaohongshuUploadFileReadback {
  return {
    filesLength: readback.filesLength,
    files: readback.files.map((file) => ({
      name: expected && file.name === expected.name ? file.name : null,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified
    }))
  };
}

/**
 * Performs the controlled Layer 1/Layer 2 upload proof on one resolved input.
 * The locator is resolved to one ElementHandle before mutation; the same
 * handle receives setInputFiles and the immediate FileList readback. There is
 * intentionally no retry or second locator query in this function.
 */
export async function readXiaohongshuUploadInputImmediately(
  input: Locator,
  images: readonly string[],
  expected?: XiaohongshuUploadFileExpectation,
  onMutationStarted?: () => void
): Promise<XiaohongshuUploadInputImmediateReadback> {
  let handle: ElementHandle<HTMLInputElement> | null;
  try {
    handle = await input.elementHandle() as ElementHandle<HTMLInputElement> | null;
  } catch {
    return failed("FILE_INPUT_HANDLE_UNAVAILABLE");
  }
  if (!handle) return failed("FILE_INPUT_HANDLE_UNAVAILABLE");

  let fingerprint: XiaohongshuUploadInputFingerprint;
  try {
    fingerprint = await handle.evaluate((element) => {
      const inputElement = element as HTMLInputElement;
      const className = typeof inputElement.className === "string" ? inputElement.className.slice(0, 160) : "";
      return {
        tagName: inputElement.tagName.toUpperCase(),
        type: inputElement.type,
        accept: inputElement.accept.slice(0, 160),
        multiple: inputElement.multiple,
        disabled: inputElement.disabled,
        connected: inputElement.isConnected,
        classNameSafe: className
      };
    });
  } catch {
    return failed("FILE_INPUT_HANDLE_UNAVAILABLE");
  }
  if (fingerprint.tagName !== "INPUT" || fingerprint.type.toLowerCase() !== "file" || fingerprint.disabled || !fingerprint.connected) {
    return failed("INPUT_NOT_USABLE", fingerprint);
  }

  try {
    onMutationStarted?.();
    await handle.setInputFiles(images);
  } catch {
    return failed("SET_INPUT_FILES_FAILED", fingerprint);
  }

  let rawReadback: XiaohongshuUploadFileReadback;
  try {
    rawReadback = await handle.evaluate((element) => {
      const inputElement = element as HTMLInputElement;
      const files = Array.from(inputElement.files ?? []).slice(0, 8).map((file) => ({
        name: file.name,
        size: Number.isFinite(file.size) ? file.size : null,
        type: file.type || null,
        lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null
      }));
      return { filesLength: inputElement.files?.length ?? 0, files };
    });
  } catch {
    return failed("INPUT_DETACHED_DURING_READBACK", fingerprint);
  }

  const fixtureMatch: XiaohongshuUploadFixtureMatch = expected ? matchesExpectedFile(rawReadback, expected) ? "YES" : "NO" : "NOT_REQUIRED";
  const readback = safeReadback(rawReadback, expected);
  const countMatches = rawReadback.filesLength === images.length;
  const status = countMatches && (!expected || fixtureMatch === "YES") ? "PASS" : "FAIL";
  return {
    status,
    failureCode: status === "PASS" ? null : "FILE_INPUT_READBACK_MISMATCH",
    fingerprint,
    readback,
    expectedFixtureMatch: fixtureMatch
  };
}
