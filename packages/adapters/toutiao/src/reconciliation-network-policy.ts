import type { Request } from "playwright-core";

export type ReconciliationDecision = "ALLOW_READ" | "BLOCK_TELEMETRY" | "BLOCK_CONTENT_MUTATION" | "BLOCK_UNKNOWN";

export interface ProvenReadonlyPost {
  readonly host: string;
  readonly path: string;
  readonly allowedBodyKeys: readonly string[];
  readonly allowedQueryKeys: readonly string[];
}

const MUTATION_PATH = /(?:^|\/)(?:article\/(?:new|publish|save|create|update|delete)|draft(?:\/|$)|upload(?:\/|$)|media\/create|image\/upload|schedule(?:\/|$)|delete(?:\/|$)|update(?:\/|$)|modify(?:\/|$))/iu;
const MUTATION_KEY = /^(?:publish|save|delete|update|modify|create|draft|content|title|article_id|timer_time)$/iu;
const TELEMETRY_PATHS = new Set([
  "mp.toutiao.com/monitor_browser/collect/batch/",
  "security.zijieapi.com/api/metrics/emit"
]);

export function classifyReconciliationRequest(input: {
  readonly method: string; readonly url: string;
  readonly bodyKeys?: readonly string[];
}, provenReadonlyPosts: readonly ProvenReadonlyPost[] = []): ReconciliationDecision {
  let url: URL;
  try { url = new URL(input.url); } catch { return "BLOCK_UNKNOWN"; }
  const method = input.method.toUpperCase();
  if (url.protocol !== "https:") return "BLOCK_CONTENT_MUTATION";
  if (method === "GET" && url.hostname === "mp.toutiao.com"
    && url.pathname === "/profile_v4/manage/draft") return "ALLOW_READ";
  if (MUTATION_PATH.test(url.pathname)) return "BLOCK_CONTENT_MUTATION";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "ALLOW_READ";
  if (method !== "POST") return "BLOCK_UNKNOWN";
  if (TELEMETRY_PATHS.has(`${url.hostname}${url.pathname}`)) return "BLOCK_TELEMETRY";
  const rule = provenReadonlyPosts.find((item) => item.host === url.hostname && item.path === url.pathname);
  if (!rule) return "BLOCK_UNKNOWN";
  const bodyKeys = input.bodyKeys ?? [];
  const queryKeys = [...url.searchParams.keys()];
  if (bodyKeys.some((key) => MUTATION_KEY.test(key) || !rule.allowedBodyKeys.includes(key))
    || queryKeys.some((key) => MUTATION_KEY.test(key) || !rule.allowedQueryKeys.includes(key))) return "BLOCK_UNKNOWN";
  return "ALLOW_READ";
}

export function safeReconciliationRequestMetadata(request: Request): {
  method: string; host: string; path: string; queryKeys: string[]; bodyKeys: string[];
  contentType: string | null; resourceType: string; initiatorPage: string | null;
} {
  let url: URL;
  try { url = new URL(request.url()); }
  catch { url = new URL("https://invalid.local/"); }
  const rawContentType = request.headers()["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  const contentType = rawContentType && /^[a-z0-9.+_-]+\/[a-z0-9.+_-]+$/u.test(rawContentType)
    ? rawContentType : null;
  const postData = request.postData();
  let bodyKeys: string[] = [];
  if (postData && contentType === "application/x-www-form-urlencoded") {
    bodyKeys = [...new URLSearchParams(postData).keys()];
  } else if (postData && contentType === "application/json") {
    try {
      const body: unknown = JSON.parse(postData);
      if (body && typeof body === "object" && !Array.isArray(body)) bodyKeys = Object.keys(body);
    } catch { /* malformed bodies remain opaque */ }
  }
  let initiatorPage: string | null = null;
  try {
    const pageUrl = new URL(request.frame().url());
    initiatorPage = `${pageUrl.hostname}${pageUrl.pathname}`;
  } catch { /* service worker and navigation requests may have no frame */ }
  const safe = (name: string): string => /^[a-z0-9_-]{1,80}$/iu.test(name) ? name : "[redacted-name]";
  return { method: request.method().toUpperCase(), host: url.hostname.slice(0, 100),
    path: url.pathname.slice(0, 180), queryKeys: [...new Set([...url.searchParams.keys()].map(safe))].sort(),
    bodyKeys: [...new Set(bodyKeys.map(safe))].sort(), contentType,
    resourceType: request.resourceType().slice(0, 40), initiatorPage };
}
