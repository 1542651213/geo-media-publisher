/** Diagnostic-only request material. It must remain in Main memory and must never be serialized to IPC, DB, or logs. */
export interface BrowserGeneratedReadonlyRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface SafeBrowserGeneratedRequestShape {
  readonly method: "GET" | "OPTIONS";
  readonly host: "mp.toutiao.com";
  readonly path: string;
  readonly queryParameterNames: readonly string[];
  readonly headerNames: readonly string[];
  readonly bodyKeyNames: readonly string[];
  readonly bodySha256: null;
  readonly signedParameterNames: readonly string[];
}

export interface SafeReadonlyReplayResult {
  readonly attempted: boolean;
  readonly reasonCode: "OK" | "REQUEST_NOT_ALLOWLISTED" | "INVALID_REQUEST_MATERIAL" | "REDIRECT_NOT_FOLLOWED" | "TRANSPORT_ERROR" | "RESPONSE_TOO_LARGE" | "PROTOCOL_MISMATCH";
  readonly browserStatus: number;
  readonly nodeStatus: number | null;
  readonly nodeMediaType: "JSON" | "TEXT_PLAIN" | "HTML" | "OTHER" | "MISSING" | null;
  readonly browserAuthState: "VALID" | "INVALID" | "UNKNOWN";
  readonly nodeAuthState: "VALID" | "INVALID" | "UNKNOWN";
  readonly authStatesMatch: boolean | null;
  readonly responseKeyShape: readonly string[];
}

const READONLY_PATHS = new Set([
  "/mp/agw/media/user_login_status_api",
  "/mp/agw/creator_center/user_info",
  "/mp/agw/media/get_media_info"
]);

function allowedUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "mp.toutiao.com" || url.username || url.password
      || url.port || url.hash || !READONLY_PATHS.has(url.pathname)) return null;
    if (["action", "operation", "op", "cmd"].some((key) => url.searchParams.has(key))) return null;
    return url;
  } catch { return null; }
}

/** Names only. Neither URL query values nor header values enter the returned object. */
export function describeReadonlyBrowserRequest(request: BrowserGeneratedReadonlyRequest): SafeBrowserGeneratedRequestShape | null {
  const url = allowedUrl(request.url);
  const method = request.method.toUpperCase();
  if (!url || (method !== "GET" && method !== "OPTIONS") || request.body !== undefined) return null;
  const safeName = (name: string) => /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u.test(name) ? name : "redactedName";
  const queryParameterNames = [...new Set([...url.searchParams.keys()].map(safeName))].sort();
  const headerNames = [...new Set(Object.keys(request.headers).map((name) => safeName(name.toLowerCase())))].sort();
  const signedParameterNames = [...new Set([...queryParameterNames, ...headerNames]
    .filter((name) => /^(?:a_bogus|x-bogus|(?:x-)?[\w-]*sign(?:ature)?[\w-]*)$/iu.test(name)))].sort();
  return { method, host: "mp.toutiao.com", path: url.pathname, queryParameterNames, headerNames,
    bodyKeyNames: [], bodySha256: null, signedParameterNames };
}

function safeResponseShape(value: unknown): string[] {
  const keys: string[] = [];
  const visit = (current: unknown, prefix: string, depth: number): void => {
    if (depth > 2 || !current || typeof current !== "object" || Array.isArray(current)) return;
    for (const [key, child] of Object.entries(current)) {
      if (keys.length >= 50) return;
      if (!/^[a-zA-Z_][\w-]{0,49}$/u.test(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      keys.push(path);
      visit(child, path, depth + 1);
    }
  };
  visit(value, "", 0);
  return keys.sort();
}

function authState(value: unknown): "VALID" | "INVALID" | "UNKNOWN" {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "UNKNOWN";
  const root = value as Record<string, unknown>;
  if (root.code !== 0 || !root.data || typeof root.data !== "object" || Array.isArray(root.data)) return "UNKNOWN";
  const isLogin = (root.data as Record<string, unknown>).is_login;
  return isLogin === true ? "VALID" : isLogin === false ? "INVALID" : "UNKNOWN";
}

async function boundedResponseJson(response: Response): Promise<unknown> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("json") && !contentType.startsWith("text/plain")) throw new Error("PROTOCOL_MISMATCH");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared > 256_000) throw new Error("RESPONSE_TOO_LARGE");
  if (!response.body) throw new Error("PROTOCOL_MISMATCH");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 256_000) throw new Error("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error("PROTOCOL_MISMATCH"); }
}

/** Strictly one GET to the captured Creator host and path. Redirects are never followed. */
export async function replayCapturedReadonlyGet(
  request: BrowserGeneratedReadonlyRequest,
  browser: Readonly<{ status: number; authState: "VALID" | "INVALID" | "UNKNOWN" }>,
  transport: (url: string, init: RequestInit) => Promise<Response> = fetch
): Promise<SafeReadonlyReplayResult> {
  const base = { browserStatus: browser.status, browserAuthState: browser.authState,
    nodeStatus: null, nodeMediaType: null, nodeAuthState: "UNKNOWN" as const, authStatesMatch: null, responseKeyShape: [] as string[] };
  const shape = describeReadonlyBrowserRequest(request);
  if (!shape || shape.method !== "GET") return { ...base, attempted: false, reasonCode: "REQUEST_NOT_ALLOWLISTED" };
  const entries = Object.entries(request.headers);
  if (entries.length > 60 || entries.some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u.test(key)
    || value.length > 8_192 || /[\r\n]/u.test(value))) return { ...base, attempted: false, reasonCode: "INVALID_REQUEST_MATERIAL" };
  const hopByHop = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding", "proxy-connection"]);
  const headers = Object.fromEntries(entries.filter(([key]) => !hopByHop.has(key.toLowerCase())));
  let response: Response;
  try {
    response = await transport(request.url, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(7_000) });
  } catch { return { ...base, attempted: true, reasonCode: "TRANSPORT_ERROR" }; }
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const nodeMediaType: SafeReadonlyReplayResult["nodeMediaType"] = !contentType ? "MISSING"
    : contentType.includes("json") ? "JSON" : contentType.startsWith("text/plain") ? "TEXT_PLAIN"
      : contentType.includes("html") ? "HTML" : "OTHER";
  if (response.status >= 300 && response.status < 400)
    return { ...base, attempted: true, reasonCode: "REDIRECT_NOT_FOLLOWED", nodeStatus: response.status, nodeMediaType };
  try {
    const body = await boundedResponseJson(response);
    const nodeAuthState = shape.path === "/mp/agw/media/user_login_status_api" ? authState(body) : "UNKNOWN";
    return { ...base, attempted: true, reasonCode: "OK", nodeStatus: response.status, nodeMediaType, nodeAuthState,
      authStatesMatch: browser.authState === "UNKNOWN" || nodeAuthState === "UNKNOWN" ? null : browser.authState === nodeAuthState,
      responseKeyShape: safeResponseShape(body) };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const reasonCode = code === "RESPONSE_TOO_LARGE" ? "RESPONSE_TOO_LARGE" : "PROTOCOL_MISMATCH";
    return { ...base, attempted: true, reasonCode, nodeStatus: response.status, nodeMediaType };
  }
}
