import { createHash } from "node:crypto";

export type ToutiaoTokenRequirement = "REQUIRED" | "OPTIONAL" | "DERIVED" | "EPHEMERAL" | "UNKNOWN";
export type ToutiaoTokenLifetime = "SESSION_SCOPED" | "REQUEST_SCOPED" | "SHORT_LIVED" | "UNKNOWN";
export interface ToutiaoProtocolProfile {
  readonly version: string;
  readonly provenance: "UNVERIFIED" | "AUTHORIZED_SHADOW_CAPTURE";
  readonly capturedAt: string | null;
  readonly authResponseShapeVersion: string;
  readonly signerStrategy: "BLOCKED" | "BROWSER_NATIVE_SIGNER" | "LOCAL_ALGORITHM";
  readonly tokens: Readonly<Record<"csrf" | "antiToken" | "msToken", Readonly<{ requirement: ToutiaoTokenRequirement; lifetime: ToutiaoTokenLifetime }>>>;
  readonly signerDependencies: Readonly<Record<"url" | "query" | "body" | "userAgent" | "timestamp" | "msToken" | "cookieSession" | "environment" | "randomness", "OBSERVED" | "UNKNOWN">>;
}

/** No field in this profile claims knowledge of the current creator protocol. */
export const UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE: Readonly<ToutiaoProtocolProfile> = Object.freeze({
  version: "toutiao-article-unverified-r1d", provenance: "UNVERIFIED", capturedAt: null,
  authResponseShapeVersion: "UNKNOWN", signerStrategy: "BLOCKED",
  tokens: { csrf: { requirement: "UNKNOWN", lifetime: "UNKNOWN" }, antiToken: { requirement: "UNKNOWN", lifetime: "UNKNOWN" },
    msToken: { requirement: "UNKNOWN", lifetime: "UNKNOWN" } },
  signerDependencies: { url: "UNKNOWN", query: "UNKNOWN", body: "UNKNOWN", userAgent: "UNKNOWN", timestamp: "UNKNOWN",
    msToken: "UNKNOWN", cookieSession: "UNKNOWN", environment: "UNKNOWN", randomness: "UNKNOWN" }
} as const);

export type ToutiaoShadowReadiness = "SHADOW_DISABLED" | "BLOCKED_NO_AUTHORIZED_SESSION" | "BLOCKED_SESSION_NOT_ATTACHED" | "OBSERVE_ONLY_READY";
export function describeShadowReadiness(enabled: boolean, accountState: "VALID" | "INVALID" | "EXPIRED" | "UNKNOWN", appOwnedSessionAttached = false): ToutiaoShadowReadiness {
  if (!enabled) return "SHADOW_DISABLED";
  if (accountState !== "VALID") return "BLOCKED_NO_AUTHORIZED_SESSION";
  return appOwnedSessionAttached ? "OBSERVE_ONLY_READY" : "BLOCKED_SESSION_NOT_ATTACHED";
}

export interface RawToutiaoShadowObservation {
  readonly source: "MOCK_FIXTURE" | "AUTHORIZED_SHADOW_CAPTURE";
  readonly capturedAt: string;
  readonly responseShapeVersion?: string;
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseBody: unknown;
  readonly cookies: readonly Readonly<{ name: string; value?: string; domain: string; path: string; secure: boolean; httpOnly: boolean; sameSite: string }> [];
  readonly tokenCandidates: Readonly<Partial<Record<"csrf" | "antiToken" | "msToken" | "aBogus", string | null>>>;
}
export interface SafeToutiaoProtocolObservation {
  readonly source: RawToutiaoShadowObservation["source"];
  readonly secretsRedacted: true;
  readonly capturedAt: string;
  readonly platform: "toutiao";
  readonly host: string;
  readonly endpointPath: string;
  readonly method: "GET" | "OPTIONS";
  readonly status: number;
  readonly responseShapeVersion: string;
  readonly queryParameterNames: readonly string[];
  readonly requestHeaderNames: readonly string[];
  readonly responseHeaderNames: readonly string[];
  readonly responseKeyShape: readonly string[];
  readonly cookies: readonly Readonly<{ name: string; domain: string; path: string; secure: boolean; httpOnly: boolean; sameSite: string }> [];
  readonly tokens: Readonly<Record<"csrf" | "antiToken" | "msToken" | "aBogus", Readonly<{ present: boolean; length: number; sha256: string | null }>>>;
}

function safeName(name: string): string {
  return /^[a-zA-Z_$][\w$-]{0,79}$/u.test(name) ? name : "redactedKey";
}

function keyShape(body: unknown): string[] {
  const result: string[] = [];
  function visit(value: unknown, prefix: string, depth: number): void {
    if (depth > 5 || result.length >= 100 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { if (value[0] !== undefined) visit(value[0], `${prefix}[]`, depth + 1); return; }
    for (const [key, item] of Object.entries(value)) {
      if (result.length >= 100) break;
      const path = prefix ? `${prefix}.${safeName(key)}` : safeName(key);
      result.push(path);
      visit(item, path, depth + 1);
    }
  }
  visit(body, "", 0);
  return result;
}

function tokenEvidence(value: string | null | undefined): { present: boolean; length: number; sha256: string | null } {
  return value ? { present: true, length: value.length, sha256: createHash("sha256").update(value).digest("hex") }
    : { present: false, length: 0, sha256: null };
}

/** Converts transient browser diagnostics to an allowlisted, non-replayable record. It performs no HTTP request. */
export function captureSafeProtocolObservation(input: RawToutiaoShadowObservation): SafeToutiaoProtocolObservation {
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error("UNSAFE_SHADOW_OBSERVATION"); }
  const method = input.method.toUpperCase();
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { throw new Error("UNSAFE_SHADOW_OBSERVATION"); }
  if (url.protocol !== "https:" || !["mp.toutiao.com", "mssdk.bytedance.com"].includes(url.hostname.toLowerCase())
    || url.username || url.password || !["GET", "OPTIONS"].includes(method)
    || /\/(?:article\/(?:new|publish|save)|draft|upload|delete|create)(?:\/|$)/iu.test(decodedPath)
    || !Number.isInteger(input.status) || input.status < 100 || input.status > 599
    || !Number.isFinite(Date.parse(input.capturedAt))) throw new Error("UNSAFE_SHADOW_OBSERVATION");
  const names = (headers: Readonly<Record<string, string>>) => [...new Set(Object.keys(headers).map((name) => safeName(name.toLowerCase())))].sort();
  const endpointPath = decodedPath.split("/").map((part) => !part || /^[a-zA-Z_][\w.-]{0,63}$/u.test(part) ? part : "redactedSegment").join("/");
  return {
    source: input.source, secretsRedacted: true, capturedAt: input.capturedAt, platform: "toutiao", host: url.hostname.toLowerCase(),
    endpointPath, method: method as "GET" | "OPTIONS", status: input.status,
    responseShapeVersion: safeName(input.responseShapeVersion ?? "UNKNOWN"),
    queryParameterNames: [...new Set([...url.searchParams.keys()].map(safeName))].sort(),
    requestHeaderNames: names(input.requestHeaders), responseHeaderNames: names(input.responseHeaders),
    responseKeyShape: keyShape(input.responseBody),
    cookies: input.cookies.map((cookie) => ({ name: safeName(cookie.name),
      domain: /^\.?[a-z0-9.-]{1,100}$/iu.test(cookie.domain) ? cookie.domain.toLowerCase() : "redacted.invalid",
      path: cookie.path.split("/").map((part) => !part || /^[a-zA-Z_][\w.-]{0,40}$/u.test(part) ? part : "redactedSegment").join("/"),
      secure: cookie.secure, httpOnly: cookie.httpOnly,
      sameSite: ["Strict", "Lax", "None"].includes(cookie.sameSite) ? cookie.sameSite : "Unspecified" })),
    tokens: { csrf: tokenEvidence(input.tokenCandidates.csrf), antiToken: tokenEvidence(input.tokenCandidates.antiToken),
      msToken: tokenEvidence(input.tokenCandidates.msToken), aBogus: tokenEvidence(input.tokenCandidates.aBogus) }
  };
}
