import { createHash } from "node:crypto";
import { normalizeToutiaoArticleContent } from "./content";
import { resolveCreatorCookies, type ToutiaoCookie } from "./auth/cookie-resolver";

const PUBLISH_ORIGIN = "https://mp.toutiao.com";
const PUBLISH_PATH = "/mp/agw/article/publish";
export const MAX_CAPTURE_TO_SEND_DELAY_MS = 30_000;
const TRANSPORT_MANAGED_HEADERS = new Set(["content-length", "host", "connection", "transfer-encoding", "keep-alive"]);

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
      throw new Error("TOUTIAO_CAPTURE_EXPIRED");
    return this.#raw;
  }

  /** Compare the exact title and normalized complete text without exposing the form. */
  assertArticleBinding(article: { readonly title: string; readonly body: string }): true {
    const url = new URL(this.#raw.url);
    if (!url.searchParams.get("a_bogus")) throw new Error("TOUTIAO_REQUEST_SIGNATURE_MISSING");
    const form = new URLSearchParams(this.#raw.body.toString("utf8"));
    const title = form.getAll("title");
    const content = form.getAll("content");
    const normalize = (text: string): string => text.normalize("NFC").replace(/\s+/gu, " ").trim();
    const preparedContent = normalizeToutiaoArticleContent(content[0] ?? "");
    const expectedContent = normalizeToutiaoArticleContent(article.body);
    const covers = form.get("pgc_feed_covers");
    const timerStatus = form.get("timer_status");
    const timerTime = form.get("timer_time");
    if (title.length !== 1 || content.length !== 1 || normalize(title[0] ?? "") !== normalize(article.title)
      || preparedContent.plainText !== expectedContent.plainText || preparedContent.imageReferences.length !== 0
      || covers && !["[]", "{}", "null"].includes(covers.trim())
      || timerStatus && !["0", "false"].includes(timerStatus.trim().toLowerCase())
      || timerTime && timerTime.trim() !== "0")
      throw new Error("TOUTIAO_REQUEST_CONTENT_MISMATCH");
    return true;
  }

  assertCookieBinding(cookies: readonly ToutiaoCookie[]): true {
    const header = Object.entries(this.#raw.headers).find(([name]) => name.toLowerCase() === "cookie")?.[1];
    if (!header) throw new Error("TOUTIAO_CAPTURE_CREDENTIAL_MISMATCH");
    const selected = resolveCreatorCookies(cookies, []).selected;
    const expected = new Map(selected.map((item) => [item.name, item.value]));
    const pairs = header.split(";").map((part) => part.trim()).filter(Boolean);
    if (!pairs.length || pairs.some((pair) => {
      const separator = pair.indexOf("=");
      if (separator < 1) return true;
      return expected.get(pair.slice(0, separator)) !== pair.slice(separator + 1);
    })) throw new Error("TOUTIAO_CAPTURE_CREDENTIAL_MISMATCH");
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
  catch { throw new Error("TOUTIAO_CAPTURE_INVALID_REQUEST"); }
  const contentType = Object.entries(input.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
  if (input.method !== "POST" || url.origin !== PUBLISH_ORIGIN || url.pathname !== PUBLISH_PATH || url.hash
    || !contentType?.toLowerCase().startsWith("application/x-www-form-urlencoded") || !Buffer.isBuffer(input.body)
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
      throw new Error("TOUTIAO_REQUEST_BINDING_MISMATCH");
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
