import { createHash } from "node:crypto";
import { normalizeToutiaoArticleContent } from "./content";
import type { ToutiaoCookie } from "./auth/cookie-resolver";

const PUBLISH_ORIGIN = "https://mp.toutiao.com";
const PUBLISH_PATH = "/mp/agw/article/publish";
export const MAX_CAPTURE_TO_SEND_DELAY_MS = 30_000;
const TRANSPORT_MANAGED_HEADERS = new Set(["content-length", "host", "connection", "transfer-encoding", "keep-alive"]);

export type ToutiaoCaptureBindingReason = "CAPTURE_TOO_OLD" | "REQUEST_METHOD_MISMATCH" | "REQUEST_HOST_MISMATCH"
  | "ACCOUNT_ID_MISMATCH"
  | "REQUEST_PATH_MISMATCH" | "CONTENT_TYPE_MISMATCH" | "TITLE_BINDING_MISMATCH" | "BODY_BINDING_MISMATCH"
  | "CONTENT_BINDING_HASH_MISMATCH" | "COOKIE_BINDING_MISMATCH" | "DYNAMIC_FIELD_MISSING"
  | "REQUEST_HASH_MISMATCH" | "UNKNOWN_BINDING_FAILURE";

/** The code is safe to log. Error messages never include captured values. */
export class ToutiaoCaptureBindingError extends Error {
  constructor(readonly code: ToutiaoCaptureBindingReason) { super(code); }
}

export interface CapturedPublishRequestEvidence {
  readonly requestHash: string;
  /** Semantic request payload excludes transient authentication and signature fields. */
  readonly finalPayloadHash: string;
  readonly bodyHash: string;
  readonly bodyByteLength: number;
  readonly queryKeyNames: readonly string[];
  readonly headerKeyNames: readonly string[];
  readonly capturedAt: string;
}

interface RawPublishRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

/** Main-memory-only material. The class deliberately serializes to sanitized evidence. */
export class AbortedPublishRequest {
  readonly #raw: RawPublishRequest;
  readonly #capturedAtMs: number;
  readonly evidence: CapturedPublishRequestEvidence;
  get requestHash(): string { return this.evidence.requestHash; }
  get finalPayloadHash(): string { return this.evidence.finalPayloadHash; }

  constructor(raw: RawPublishRequest, capturedAtMs: number, evidence: CapturedPublishRequestEvidence) {
    this.#raw = raw;
    this.#capturedAtMs = capturedAtMs;
    this.evidence = Object.freeze(evidence);
  }

  /** Only the replay boundary can consume the material; never expose via IPC or JSON. */
  forReplay(nowMs: number): RawPublishRequest {
    if (!Number.isFinite(nowMs) || nowMs < this.#capturedAtMs || nowMs - this.#capturedAtMs > MAX_CAPTURE_TO_SEND_DELAY_MS)
      throw new ToutiaoCaptureBindingError("CAPTURE_TOO_OLD");
    return this.#raw;
  }

  /** Compare the exact title and normalized complete text without exposing the form. */
  assertArticleBinding(article: { readonly title: string; readonly body: string }): true {
    const url = new URL(this.#raw.url);
    if (!url.searchParams.get("a_bogus")) throw new ToutiaoCaptureBindingError("DYNAMIC_FIELD_MISSING");
    const form = new URLSearchParams(this.#raw.body.toString("utf8"));
    const title = form.getAll("title");
    const content = form.getAll("content");
    const normalize = (text: string): string => text.normalize("NFC").replace(/\s+/gu, " ").trim();
    const preparedContent = normalizeToutiaoArticleContent(content[0] ?? "");
    const expectedContent = normalizeToutiaoArticleContent(article.body);
    const covers = form.get("pgc_feed_covers");
    const timerStatus = form.get("timer_status");
    const timerTime = form.get("timer_time");
    if (title.length !== 1 || normalize(title[0] ?? "") !== normalize(article.title))
      throw new ToutiaoCaptureBindingError("TITLE_BINDING_MISMATCH");
    if (content.length !== 1 || preparedContent.plainText !== expectedContent.plainText
      || preparedContent.imageReferences.length !== 0
      || /<\s*\/?\s*(?:a|img|video|iframe|audio|object|embed|table|ul|ol|li|h[1-6]|blockquote)\b|(?:href|src)\s*=/iu.test(content[0] ?? ""))
      throw new ToutiaoCaptureBindingError("BODY_BINDING_MISMATCH");
    if (covers && !["[]", "{}", "null"].includes(covers.trim())
      || timerStatus && !["0", "false"].includes(timerStatus.trim().toLowerCase())
      || timerTime && timerTime.trim() !== "0")
      throw new ToutiaoCaptureBindingError("CONTENT_BINDING_HASH_MISMATCH");
    return true;
  }

  assertCookieBinding(cookies: readonly ToutiaoCookie[]): true {
    const header = Object.entries(this.#raw.headers).find(([name]) => name.toLowerCase() === "cookie")?.[1];
    if (!header) throw new ToutiaoCaptureBindingError("COOKIE_BINDING_MISMATCH");
    const request = new URL(this.#raw.url);
    const now = Date.now();
    const eligible = cookies.filter((cookie) => {
      const domain = cookie.domain.toLowerCase().replace(/^\./u, "");
      const path = cookie.path || "/";
      const requestPath = request.pathname;
      return cookie.name && cookie.value && request.protocol === "https:"
        && (cookie.hostOnly ? request.hostname === domain
          : request.hostname === domain || request.hostname.endsWith(`.${domain}`))
        && (requestPath === path || requestPath.startsWith(path.endsWith("/") ? path : `${path}/`))
        && (!cookie.expiresAt || Date.parse(cookie.expiresAt) > now);
    });
    // A browser may send same-name cookies from both the creator host and its parent domain.
    // Match each captured pair to one currently eligible Context cookie without logging values.
    const available = new Map<string, number>();
    for (const cookie of eligible) {
      const key = `${cookie.name}\0${cookie.value}`;
      available.set(key, (available.get(key) ?? 0) + 1);
    }
    const pairs = header.split(";").map((part) => part.trim()).filter(Boolean);
    if (!pairs.length || pairs.some((pair) => {
      const separator = pair.indexOf("=");
      if (separator < 1) return true;
      const key = `${pair.slice(0, separator)}\0${pair.slice(separator + 1)}`;
      const count = available.get(key) ?? 0;
      if (count < 1) return true;
      available.set(key, count - 1);
      return false;
    })) throw new ToutiaoCaptureBindingError("COOKIE_BINDING_MISMATCH");
    return true;
  }

  toJSON(): CapturedPublishRequestEvidence { return this.evidence; }
}

function safeName(value: string): string {
  return /^[a-z0-9_-]{1,80}$/iu.test(value) ? value : "[redacted-name]";
}

function hashRequest(raw: RawPublishRequest): string {
  const url = new URL(raw.url);
  const headers = Object.entries(raw.headers)
    .filter(([name]) => !TRANSPORT_MANAGED_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const hash = createHash("sha256");
  hash.update(raw.method).update("\n").update(url.pathname).update(url.search).update("\n");
  for (const [name, value] of headers) hash.update(name).update(":").update(value).update("\n");
  hash.update("\n").update(raw.body);
  return hash.digest("hex");
}

function hashBusinessPayload(raw: RawPublishRequest): string {
  const url = new URL(raw.url);
  const query = [...url.searchParams.entries()]
    .filter(([name]) => !/^(?:a_bogus|msToken|csrf|tt-anti-token|signature|x-bogus)$/iu.test(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue));
  const contentType = Object.entries(raw.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return createHash("sha256").update("toutiao-final-business-request-v1\n").update(raw.method).update("\n")
    .update(url.pathname).update("\n").update(JSON.stringify(query)).update("\n")
    .update(contentType).update("\n").update(raw.body).digest("hex");
}

export function captureAbortedPublishRequest(input: RawPublishRequest, capturedAtMs: number): AbortedPublishRequest {
  let url: URL;
  try { url = new URL(input.url); }
  catch { throw new ToutiaoCaptureBindingError("REQUEST_HOST_MISMATCH"); }
  const contentType = Object.entries(input.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
  if (input.method !== "POST") throw new ToutiaoCaptureBindingError("REQUEST_METHOD_MISMATCH");
  if (url.origin !== PUBLISH_ORIGIN) throw new ToutiaoCaptureBindingError("REQUEST_HOST_MISMATCH");
  if (url.pathname !== PUBLISH_PATH || url.hash) throw new ToutiaoCaptureBindingError("REQUEST_PATH_MISMATCH");
  if (!contentType?.toLowerCase().startsWith("application/x-www-form-urlencoded"))
    throw new ToutiaoCaptureBindingError("CONTENT_TYPE_MISMATCH");
  if (!Buffer.isBuffer(input.body)
    || input.body.length === 0 || input.body.length > 512_000 || input.url.length > 16_384
    || Object.entries(input.headers).some(([name, value]) => name.length > 128 || value.length > 65_536 || /[\r\n]/u.test(name + value))
    || !Number.isFinite(capturedAtMs))
    throw new Error("TOUTIAO_CAPTURE_INVALID_REQUEST");
  const raw: RawPublishRequest = {
    method: input.method, url: input.url,
    headers: Object.freeze({ ...input.headers }), body: Buffer.from(input.body)
  };
  const evidence: CapturedPublishRequestEvidence = {
    requestHash: hashRequest(raw), finalPayloadHash: hashBusinessPayload(raw),
    bodyHash: createHash("sha256").update(raw.body).digest("hex"),
    bodyByteLength: raw.body.length,
    queryKeyNames: Object.freeze([...new Set([...url.searchParams.keys()].map(safeName))].sort()),
    headerKeyNames: Object.freeze([...new Set(Object.keys(raw.headers).map((name) => safeName(name.toLowerCase())))].sort()),
    capturedAt: new Date(capturedAtMs).toISOString()
  };
  return new AbortedPublishRequest(raw, capturedAtMs, evidence);
}

export interface ReplayResponseEvidence {
  readonly status: number;
  readonly responseShape: readonly string[];
  readonly platformCode?: string | number | null;
  readonly remoteId?: string | null;
}

export type ReplayTransport = (request: RawPublishRequest) => Promise<ReplayResponseEvidence>;

/** Consumes its one-shot permit before the transport call, including timeout or lost response. */
export class CapturedRequestReplay {
  private readonly usedAttempts = new Set<string>();
  constructor(private readonly transport: ReplayTransport) {}

  async sendOnce(captured: AbortedPublishRequest, permit: {
    readonly submissionAttemptId: string;
    readonly claimedRequestHash: string;
    readonly claimedAt: number;
  }, nowMs = Date.now()): Promise<ReplayResponseEvidence> {
    if (!permit.submissionAttemptId || this.usedAttempts.has(permit.submissionAttemptId))
      throw new Error("TOUTIAO_REPLAY_ALREADY_CONSUMED");
    const raw = captured.forReplay(nowMs);
    if (permit.claimedRequestHash !== captured.requestHash || permit.claimedAt > nowMs
      || permit.claimedAt < Date.parse(captured.evidence.capturedAt) - 5_000 || hashRequest(raw) !== captured.requestHash)
      throw new ToutiaoCaptureBindingError("REQUEST_HASH_MISMATCH");
    this.usedAttempts.add(permit.submissionAttemptId);
    const headers = Object.fromEntries(Object.entries(raw.headers)
      .filter(([name]) => !TRANSPORT_MANAGED_HEADERS.has(name.toLowerCase())));
    return this.transport({ method: raw.method, url: raw.url, headers, body: Buffer.from(raw.body) });
  }
}

/** Disabled until a caller has durably claimed the R1-A submit boundary. */
export async function nodeFetchReplayTransport(request: RawPublishRequest): Promise<ReplayResponseEvidence> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.origin !== PUBLISH_ORIGIN || url.pathname !== PUBLISH_PATH)
    throw new Error("TOUTIAO_REPLAY_INVALID_DESTINATION");
  const response = await fetch(request.url, {
    method: request.method, headers: request.headers,
    body: new Uint8Array(request.body), redirect: "manual", signal: AbortSignal.timeout(30_000)
  });
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 256_000) return { status: response.status, responseShape: [] };
  try {
    const decoded: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return { status: response.status, responseShape: [] };
    const object = decoded as Record<string, unknown>;
    const code = object.code;
    const data = object.data && typeof object.data === "object" && !Array.isArray(object.data)
      ? object.data as Record<string, unknown> : null;
    const rawRemoteId = data?.pgc_id ?? object.pgc_id;
    const remoteId = typeof rawRemoteId === "string" && /^[0-9]{1,32}$/u.test(rawRemoteId) ? rawRemoteId
      : typeof rawRemoteId === "number" && Number.isSafeInteger(rawRemoteId) && rawRemoteId > 0 ? String(rawRemoteId) : null;
    return { status: response.status, responseShape: Object.keys(object).map(safeName).sort(),
      platformCode: typeof code === "number" && Number.isFinite(code) ? code
        : typeof code === "string" && /^[A-Z0-9_-]{1,32}$/iu.test(code) ? code : null,
      remoteId };
  } catch { return { status: response.status, responseShape: [] }; }
}
