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
const CREATOR_READ_GET_PATHS = new Set([
  "/", "/profile_v4/index", "/profile_v4/manage/content/all", "/profile_v4/manage/draft",
  "/api/feed/mp_provider/v1/", "/api/msg/v1/list/", "/monitor_web/settings/browser-settings",
  "/mp/agw/creator_center/draft_count", "/mp/agw/creator_center/get_recommend_collection",
  "/mp/agw/creator_center/user_info", "/mp/agw/creator_center/item/list",
  "/mp/agw/creator_project/get_benefit_page_info", "/mp/agw/deliver/get_unread_confirm_message",
  "/mp/agw/deliver/personal_panel", "/mp/agw/feedback/get_unread_feedback",
  "/mp/agw/feedback/is_white", "/mp/agw/media/get_user_base_info",
  "/mp/agw/media/user_login_status_api", "/tt-anti-token", "/ucd/agw/get_store_value",
  "/user/profile/auth/info/v2/"
]);
const STATIC_HOSTS = new Set([
  "image-tt-private.toutiao.com", "ipolyfill-polyfill.byte-gslb.com",
  "lf-c-flwb.bytetos.com", "lf-cdn-tos.bytescm.com", "lf-content-ecology.toutiaostatic.com",
  "lf-security.bytegoofy.com", "lf3-beecdn.bytetos.com", "lf3-short.ibytedapm.com",
  "lf6-cdn2-tos.bytegoofy.com", "sf1-cdn-tos.toutiaostatic.com",
  "sf3-cdn-tos.toutiaostatic.com"
]);
const STATIC_PATH = /(?:\.(?:js|css|json|html|png|jpg|jpeg|svg|ico|woff2?|image)(?:~[^/]*)?)$/iu;

export function classifyReconciliationRequest(input: {
  readonly method: string; readonly url: string;
  readonly bodyKeys?: readonly string[];
}, provenReadonlyPosts: readonly ProvenReadonlyPost[] = []): ReconciliationDecision {
  let url: URL;
  try { url = new URL(input.url); } catch { return "BLOCK_UNKNOWN"; }
  const method = input.method.toUpperCase();
  if (url.protocol !== "https:") return "BLOCK_CONTENT_MUTATION";
  const knownCreatorRead = url.hostname === "mp.toutiao.com" && CREATOR_READ_GET_PATHS.has(url.pathname);
  if (MUTATION_PATH.test(url.pathname) && !(["GET", "HEAD"].includes(method) && knownCreatorRead))
    return "BLOCK_CONTENT_MUTATION";
  if (method === "GET" || method === "HEAD") return knownCreatorRead
    || STATIC_HOSTS.has(url.hostname) && STATIC_PATH.test(url.pathname) ? "ALLOW_READ" : "BLOCK_UNKNOWN";
  if (method === "OPTIONS") return "ALLOW_READ";
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
