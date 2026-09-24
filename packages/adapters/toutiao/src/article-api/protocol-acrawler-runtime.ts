import type { Page } from "playwright-core";
import { safeProtocolScriptPath } from "./protocol-script-discovery";

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

export interface SafeCdpFunctionLocation {
  readonly host: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

/** CDP script URLs and internal properties are untrusted; only allowlisted path metadata escapes. */
export function safeCdpFunctionLocation(raw: unknown, scriptUrls: ReadonlyMap<string, string>): SafeCdpFunctionLocation | null {
  const properties = record(raw)?.internalProperties;
  if (!Array.isArray(properties)) return null;
  const locationProperty = properties.find((entry: unknown) => record(entry)?.name === "[[FunctionLocation]]");
  const value = record(record(record(locationProperty)?.value)?.value);
  if (!value || typeof value.scriptId !== "string"
    || typeof value.lineNumber !== "number" || !Number.isSafeInteger(value.lineNumber) || value.lineNumber < 0
    || typeof value.columnNumber !== "number" || !Number.isSafeInteger(value.columnNumber) || value.columnNumber < 0) return null;
  const url = scriptUrls.get(value.scriptId);
  const safe = url ? safeProtocolScriptPath(url) : null;
  return safe ? { ...safe, lineNumber: value.lineNumber, columnNumber: value.columnNumber } : null;
}

export type AcrCrawlerFunctionName = "init" | "sign" | "fetch" | "XMLHttpRequest" | "XMLHttpRequest.open" | "XMLHttpRequest.send" | "Request";

export interface SafeAcrCrawlerFunctionEvidence {
  readonly name: AcrCrawlerFunctionName;
  readonly sourceSha256: string;
  readonly sourceLength: number;
  readonly nativeLike: boolean;
  readonly location: SafeCdpFunctionLocation | null;
}

export interface SafeAcrCrawlerRuntimeEvidence {
  readonly objectFound: boolean;
  readonly initSignSameObject: boolean | null;
  readonly locationStatus: "CAPTURED" | "CDP_UNAVAILABLE";
  readonly functions: readonly SafeAcrCrawlerFunctionEvidence[];
}

const EXPRESSIONS: Readonly<Record<AcrCrawlerFunctionName, string>> = {
  init: 'Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(window,"byted_acrawler")?.value??{},"init")?.value',
  sign: 'Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(window,"byted_acrawler")?.value??{},"sign")?.value',
  fetch: 'Object.getOwnPropertyDescriptor(window,"fetch")?.value',
  XMLHttpRequest: 'Object.getOwnPropertyDescriptor(window,"XMLHttpRequest")?.value',
  "XMLHttpRequest.open": 'Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(window,"XMLHttpRequest")?.value?.prototype??{},"open")?.value',
  "XMLHttpRequest.send": 'Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(window,"XMLHttpRequest")?.value?.prototype??{},"send")?.value',
  Request: 'Object.getOwnPropertyDescriptor(window,"Request")?.value'
};

/** Reads function metadata and CDP locations only; it never invokes SDK or network functions. */
export async function inspectAcrCrawlerRuntime(page: Page): Promise<SafeAcrCrawlerRuntimeEvidence> {
  const metadata = await page.evaluate(async () => {
    const root = Object.getOwnPropertyDescriptor(window, "byted_acrawler");
    const sdk = root && "value" in root && root.value && typeof root.value === "object" ? root.value as object : null;
    const init = sdk ? Object.getOwnPropertyDescriptor(sdk, "init")?.value as unknown : undefined;
    const sign = sdk ? Object.getOwnPropertyDescriptor(sdk, "sign")?.value as unknown : undefined;
    const xhr = Object.getOwnPropertyDescriptor(window, "XMLHttpRequest")?.value as typeof XMLHttpRequest | undefined;
    const candidates: ReadonlyArray<readonly [AcrCrawlerFunctionName, unknown]> = [
      ["init", init],
      ["sign", sign],
      ["fetch", Object.getOwnPropertyDescriptor(window, "fetch")?.value],
      ["XMLHttpRequest", xhr],
      ["XMLHttpRequest.open", xhr ? Object.getOwnPropertyDescriptor(xhr.prototype, "open")?.value : undefined],
      ["XMLHttpRequest.send", xhr ? Object.getOwnPropertyDescriptor(xhr.prototype, "send")?.value : undefined],
      ["Request", Object.getOwnPropertyDescriptor(window, "Request")?.value]
    ];
    const functions = await Promise.all(candidates.filter((item): item is readonly [AcrCrawlerFunctionName, (...args: never[]) => unknown] =>
      typeof item[1] === "function").map(async ([name, fn]) => {
      const source = Function.prototype.toString.call(fn);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      const sourceSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return { name, sourceSha256, sourceLength: source.length, nativeLike: source.includes("[native code]") };
    }));
    return { objectFound: sdk !== null, initSignSameObject: typeof init === "function" && typeof sign === "function"
      ? Object.is(init, sign) : null, functions };
  });

  const scriptUrls = new Map<string, string>();
  const locations = new Map<AcrCrawlerFunctionName, SafeCdpFunctionLocation | null>();
  let locationStatus: SafeAcrCrawlerRuntimeEvidence["locationStatus"] = "CDP_UNAVAILABLE";
  try {
    const session = await page.context().newCDPSession(page);
    try {
      session.on("Debugger.scriptParsed", (event: unknown) => {
        const parsed = record(event);
        if (typeof parsed?.scriptId === "string" && typeof parsed.url === "string")
          scriptUrls.set(parsed.scriptId, parsed.url);
      });
      await session.send("Debugger.enable");
      await session.send("Runtime.enable");
      for (const item of metadata.functions) {
        const result: unknown = await session.send("Runtime.evaluate", {
          expression: EXPRESSIONS[item.name], returnByValue: false, silent: true
        });
        const objectId = record(record(result)?.result)?.objectId;
        if (typeof objectId !== "string") { locations.set(item.name, null); continue; }
        const properties: unknown = await session.send("Runtime.getProperties", { objectId, ownProperties: true });
        locations.set(item.name, safeCdpFunctionLocation(properties, scriptUrls));
      }
      locationStatus = "CAPTURED";
    } finally {
      await session.send("Debugger.disable").catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
  } catch { /* CDP may be unavailable; do not infer function provenance from a missing location. */ }
  return { objectFound: metadata.objectFound, initSignSameObject: metadata.initSignSameObject, locationStatus,
    functions: metadata.functions.map((item) => ({ ...item, location: locations.get(item.name) ?? null })) };
}
