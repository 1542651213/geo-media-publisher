import type { Page } from "playwright-core";

export type XiaohongshuFileInputFixtureMatch = "YES" | "NO" | "NOT_PROVEN";

export interface XiaohongshuFileInputFileSafeMetadata {
  name: string;
  size: number | null;
  type: string | null;
  lastModified: number | null;
  expectedFixtureMatch: boolean;
}

export interface XiaohongshuFileInputAncestorFingerprint {
  tagName: string;
  classNameSafe: string;
}

export interface XiaohongshuFileInputSafeNode {
  type: string | null;
  accept: string | null;
  multiple: boolean;
  disabled: boolean;
  connected: boolean;
  classNameSafe: string;
  ancestorFingerprint: readonly XiaohongshuFileInputAncestorFingerprint[];
  filesLength: number;
  files: readonly XiaohongshuFileInputFileSafeMetadata[];
}

export interface XiaohongshuFileInputDomSnapshot {
  origin: string;
  pathname: string;
  readyState: string;
  matchCount: number;
  inputs: readonly XiaohongshuFileInputSafeNode[];
}

export const XIAOHONGSHU_SAFE_FIXTURE_METADATA = {
  name: "task10s-safe-test.png",
  size: 19226,
  type: "image/png"
} as const;

function isExpectedFixture(file: Pick<XiaohongshuFileInputFileSafeMetadata, "name" | "size" | "type">): boolean {
  return file.name === XIAOHONGSHU_SAFE_FIXTURE_METADATA.name
    && file.size === XIAOHONGSHU_SAFE_FIXTURE_METADATA.size
    && file.type === XIAOHONGSHU_SAFE_FIXTURE_METADATA.type;
}

/**
 * Correlates only the fixed safe fixture metadata. It deliberately returns
 * NOT_PROVEN when more than one current input claims the fixture.
 */
export function containsExpectedXiaohongshuSafeFixture(inputs: readonly XiaohongshuFileInputSafeNode[]): XiaohongshuFileInputFixtureMatch {
  const matchingInputs = inputs.filter((input) => input.files.some((file) => file.expectedFixtureMatch || isExpectedFixture(file)));
  if (matchingInputs.length === 1) return "YES";
  if (matchingInputs.length > 1) return "NOT_PROVEN";
  return "NO";
}

/**
 * Fixed, read-only browser diagnostic. The evaluator has no access to Main
 * closures and accepts no selector, URL, page id, context id, script, or path.
 */
export async function inspectXiaohongshuFileInputState(page: Page): Promise<XiaohongshuFileInputDomSnapshot> {
  return page.evaluate(() => {
    const expectedName = "task10s-safe-test.png";
    const expectedSize = 19226;
    const expectedType = "image/png";
    const maxStringLength = 120;
    const maxInputs = 12;
    const maxFilesPerInput = 8;
    const maxAncestors = 4;
    const safeString = (value: string | null, limit = maxStringLength): string => (value ?? "").slice(0, limit);
    const classNameSafe = (element: Element): string => safeString(element.getAttribute("class"));
    const ancestorFingerprint = (element: Element): Array<{ tagName: string; classNameSafe: string }> => {
      const result: Array<{ tagName: string; classNameSafe: string }> = [];
      let current = element.parentElement;
      while (current && result.length < maxAncestors) {
        result.push({ tagName: current.tagName.toUpperCase(), classNameSafe: classNameSafe(current) });
        current = current.parentElement;
      }
      return result;
    };
    const inputElements = Array.from(document.querySelectorAll('input[type="file"]')).slice(0, maxInputs);
    const inputs = inputElements.map((element) => {
      const input = element as HTMLInputElement;
      const files = Array.from(input.files ?? []).slice(0, maxFilesPerInput).map((file) => {
        const expectedFixtureMatch = file.name === expectedName && file.size === expectedSize && file.type === expectedType;
        return {
          name: expectedFixtureMatch ? file.name : "[REDACTED_NON_FIXTURE]",
          size: expectedFixtureMatch ? file.size : null,
          type: expectedFixtureMatch ? file.type : null,
          lastModified: expectedFixtureMatch ? file.lastModified : null,
          expectedFixtureMatch
        };
      });
      return {
        type: input.getAttribute("type"),
        accept: safeString(input.getAttribute("accept")),
        multiple: input.multiple,
        disabled: input.disabled || input.hasAttribute("disabled") || input.getAttribute("aria-disabled")?.toLowerCase() === "true",
        connected: input.isConnected,
        classNameSafe: classNameSafe(input),
        ancestorFingerprint: ancestorFingerprint(input),
        filesLength: input.files?.length ?? 0,
        files
      };
    });
    return {
      origin: window.location.origin,
      pathname: window.location.pathname,
      readyState: document.readyState,
      matchCount: document.querySelectorAll('input[type="file"]').length,
      inputs
    };
  });
}
