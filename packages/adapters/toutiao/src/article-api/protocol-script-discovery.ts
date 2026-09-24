import { createHash } from "node:crypto";

export const PROTOCOL_SCRIPT_KEYWORDS = [
  "a_bogus", "x-bogus", "mstoken", "secsdk", "webmssdk", "mssdk",
  "byted_acrawler", "acrawler", "tt-anti-token", "x-secsdk-csrf-token",
  "signature", "/mp/agw/article/publish", "/mp/agw/", "sign"
] as const;

export interface SafeProtocolScriptEvidence {
  readonly host: string;
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly keywordOffsets: Readonly<Record<string, readonly number[]>>;
  readonly sdkMemberReferences: readonly Readonly<{ sdk: "byted_acrawler" | "secsdk"; member: string; offset: number }> [];
}

export interface SafeRuntimeSdkSurface {
  readonly name: "byted_acrawler" | "secsdk";
  readonly members: readonly Readonly<{ name: string; kind: string; arity: number | null }> [];
}

/** Uses descriptors so accessors and callable SDK exports are never invoked. */
export function inspectRuntimeSdkSurface(name: SafeRuntimeSdkSurface["name"]): SafeRuntimeSdkSurface | null {
  const root = Object.getOwnPropertyDescriptor(window, name);
  const value = root && "value" in root ? root.value as unknown : undefined;
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  const members = Object.getOwnPropertyNames(value).filter((key) => /^[a-zA-Z_$][\w$]{0,40}$/u.test(key)).slice(0, 40)
    .map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const member = descriptor && "value" in descriptor ? descriptor.value as unknown : undefined;
      return { name: key, kind: descriptor && !("value" in descriptor) ? "accessor" : typeof member,
        arity: typeof member === "function" ? member.length : null };
    });
  return { name, members };
}

/** Query strings and opaque path segments never leave the diagnostic process. */
export function safeProtocolScriptPath(rawUrl: string): { host: string; path: string } | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || !/^[a-z0-9.-]{1,120}$/u.test(url.hostname.toLowerCase())) return null;
    const path = "/" + url.pathname.split("/").slice(1, 9).map((part) =>
      /^[a-zA-Z_][\w.-]{0,63}$/u.test(part) ? part : "redactedSegment").join("/");
    return { host: url.hostname.toLowerCase(), path };
  } catch { return null; }
}

/** Scans a transient platform JS response; returns metadata and offsets, never source bytes. */
export function inspectProtocolScript(rawUrl: string, bytes: Uint8Array): SafeProtocolScriptEvidence | null {
  const location = safeProtocolScriptPath(rawUrl);
  if (!location || bytes.byteLength > 12_000_000) return null;
  const source = new TextDecoder().decode(bytes).toLowerCase();
  const keywordOffsets: Record<string, number[]> = {};
  const sdkMemberReferences: Array<SafeProtocolScriptEvidence["sdkMemberReferences"][number]> = [];
  for (const match of source.matchAll(/(byted_acrawler|secsdk)\s*(?:\.\s*([a-z_$][\w$]{0,40})|\[\s*["']([a-z_$][\w$]{0,40})["']\s*\])/gu)) {
    if (sdkMemberReferences.length >= 20) break;
    const sdk = match[1];
    const member = match[2] ?? match[3];
    if ((sdk === "byted_acrawler" || sdk === "secsdk") && member) sdkMemberReferences.push({ sdk, member, offset: match.index });
  }
  for (const keyword of PROTOCOL_SCRIPT_KEYWORDS) {
    const offsets: number[] = [];
    let from = 0;
    while (offsets.length < 4) {
      const offset = source.indexOf(keyword, from);
      if (offset < 0) break;
      offsets.push(offset);
      from = offset + keyword.length;
    }
    if (offsets.length > 0) keywordOffsets[keyword === "mstoken" ? "msToken" : keyword === "x-bogus" ? "X-Bogus" : keyword] = offsets;
  }
  return { ...location, byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), keywordOffsets, sdkMemberReferences };
}
