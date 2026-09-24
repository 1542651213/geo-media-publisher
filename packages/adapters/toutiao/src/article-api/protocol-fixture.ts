import type { SafeToutiaoProtocolObservation } from "./protocol-shadow";

const FIXTURE_KEYS = ["source", "secretsRedacted", "capturedAt", "platform", "host", "endpointPath", "method", "status",
  "responseShapeVersion", "queryParameterNames", "requestHeaderNames", "responseHeaderNames", "responseKeyShape", "cookies", "tokens"] as const;
const TOKEN_POST_KEYS = [...FIXTURE_KEYS, "requestBodyKeyNames", "requestBodySha256"] as const;
const COOKIE_KEYS = ["name", "domain", "path", "secure", "httpOnly", "sameSite"] as const;
const TOKEN_KEYS = ["present", "length", "sha256"] as const;
const TOKEN_NAMES = ["csrf", "antiToken", "msToken", "aBogus"] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function safeNames(value: unknown, pattern: RegExp): boolean {
  return Array.isArray(value) && value.every((name) => typeof name === "string" && name.length <= 160 && pattern.test(name));
}

export function protocolShadowEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.TOUTIAO_PROTOCOL_SHADOW_ENABLED === "true";
}

/** Exact allowlist: unexpected fields, raw bodies, headers or credentials invalidate a fixture. */
export function assertSafeProtocolFixture(value: unknown): SafeToutiaoProtocolObservation {
  const item = object(value);
  const simpleName = /^[a-zA-Z_$][\w$-]{0,79}$/u;
  const shapeName = /^[a-zA-Z_$][\w$-]*(?:\[\])*(?:\.[a-zA-Z_$][\w$-]*(?:\[\])*)*$/u;
  const tokenPost = item?.method === "POST" && item.host === "mssdk.bytedance.com"
    && ["/web/r/token", "/web/common"].includes(String(item.endpointPath));
  if (!item || !exactly(item, tokenPost ? TOKEN_POST_KEYS : FIXTURE_KEYS) || !["MOCK_FIXTURE", "AUTHORIZED_SHADOW_CAPTURE"].includes(String(item.source))
    || item.secretsRedacted !== true || item.platform !== "toutiao" || typeof item.capturedAt !== "string"
    || !Number.isFinite(Date.parse(item.capturedAt)) || !["mp.toutiao.com", "mssdk.bytedance.com"].includes(String(item.host))
    || typeof item.endpointPath !== "string" || !/^\/(?:[a-zA-Z_][\w.-]{0,63}\/)*[a-zA-Z_][\w.-]{0,63}\/?$/u.test(item.endpointPath)
    || /\/(?:article\/new|draft|upload|delete|create|save|update|publish|schedule)(?:\/|$)/iu.test(item.endpointPath)
    || (!["GET", "OPTIONS"].includes(String(item.method)) && !tokenPost) || !Number.isInteger(item.status) || Number(item.status) < 100 || Number(item.status) > 599
    || typeof item.responseShapeVersion !== "string" || !simpleName.test(item.responseShapeVersion)
    || !safeNames(item.queryParameterNames, simpleName) || !safeNames(item.requestHeaderNames, simpleName)
    || !safeNames(item.responseHeaderNames, simpleName) || !safeNames(item.responseKeyShape, shapeName)
    || !Array.isArray(item.cookies)) throw new Error("UNSAFE_TOUTIAO_PROTOCOL_FIXTURE");
  for (const entry of item.cookies) {
    const cookie = object(entry);
    if (!cookie || !exactly(cookie, COOKIE_KEYS) || typeof cookie.name !== "string" || !simpleName.test(cookie.name)
      || typeof cookie.domain !== "string" || !/^\.?[a-z0-9.-]{1,100}$/iu.test(cookie.domain)
      || typeof cookie.path !== "string" || !/^\/[a-zA-Z0-9_./-]{0,80}$/u.test(cookie.path)
      || typeof cookie.secure !== "boolean" || typeof cookie.httpOnly !== "boolean"
      || !["Strict", "Lax", "None", "Unspecified"].includes(String(cookie.sameSite))) throw new Error("UNSAFE_TOUTIAO_PROTOCOL_FIXTURE");
  }
  const tokens = object(item.tokens);
  if (!tokens || !exactly(tokens, TOKEN_NAMES)) throw new Error("UNSAFE_TOUTIAO_PROTOCOL_FIXTURE");
  for (const name of TOKEN_NAMES) {
    const token = object(tokens[name]);
    if (!token || !exactly(token, TOKEN_KEYS) || typeof token.present !== "boolean" || !Number.isInteger(token.length)
      || Number(token.length) < 0 || Number(token.length) > 16384
      || (token.present && (Number(token.length) === 0 || typeof token.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(token.sha256)))
      || (!token.present && (token.length !== 0 || token.sha256 !== null))) throw new Error("UNSAFE_TOUTIAO_PROTOCOL_FIXTURE");
  }
  if (tokenPost && (!safeNames(item.requestBodyKeyNames, simpleName)
    || (item.requestBodySha256 !== null && (typeof item.requestBodySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.requestBodySha256))))) throw new Error("UNSAFE_TOUTIAO_PROTOCOL_FIXTURE");
  return item as unknown as SafeToutiaoProtocolObservation;
}
