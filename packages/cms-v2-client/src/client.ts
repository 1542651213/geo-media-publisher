import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Capabilities, CmsRecord, ContentList, CreateContent, DeleteContent, DeployEnvironment, ExpectedPublished, Failure, FieldError, Job, Media, Publish, Purge, Rollback, SaveDraft, Success, Validation } from "./contracts";

const PREFIX = "/_publish-api/v2";
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MEDIA_MIMES: readonly Media["mime"][] = ["image/jpeg", "image/png", "image/webp"];
const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface SigningInput { method: string; target: string; siteId: string; environment: DeployEnvironment; timestamp: number; nonce: string; idempotencyKey?: string; body: Uint8Array }

/** Canonical signing contract mirrored from Kangyi clients/cms-v2/client.ts. */
export function signRequest(input: SigningInput, secret: string): string {
  const canonical = [input.method.toUpperCase(), input.target, input.siteId, input.environment, String(input.timestamp), input.nonce, input.idempotencyKey ?? "", createHash("sha256").update(input.body).digest("hex")].join("\n");
  return `sha256=${createHmac("sha256", Buffer.from(secret, "utf8")).update(canonical, "utf8").digest("hex")}`;
}

export interface ClientConfig { origin: string; siteId: string; environment: DeployEnvironment; keyId: string; secret: string; timeoutMs?: number; maxRetries?: number; retryDelayMs?: number }
export interface RequestOptions { json?: unknown; exactJson?: string; bytes?: Uint8Array; contentType?: string; idempotencyKey?: string }

export class ClientError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0, readonly requestId?: string, readonly fieldErrors?: FieldError[], readonly idempotencyKey?: string, readonly outcomeUnknown = false) { super(message); this.name = "ClientError"; }
}

export class CmsV2Client {
  private readonly config: Required<ClientConfig>;

  constructor(config: ClientConfig) {
    const url = new URL(config.origin);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("origin must contain only scheme, host and optional port");
    if (!(Object.keys({ local: true, staging: true, production: true }) as string[]).includes(config.environment)) throw new Error("Invalid environment");
    const localHttp = config.environment === "local" && url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) throw new Error("HTTPS is required except for local loopback tests");
    if (![config.siteId, config.keyId].every((value) => /^[A-Za-z0-9._~-]{1,128}$/u.test(value)) || Buffer.byteLength(config.secret ?? "", "utf8") < 32) throw new Error("Invalid scope or publish credentials");
    const settings = { timeoutMs: config.timeoutMs ?? 10_000, maxRetries: config.maxRetries ?? 0, retryDelayMs: config.retryDelayMs ?? 250 };
    if (!Number.isInteger(settings.maxRetries) || settings.maxRetries < 0 || settings.maxRetries > 5 || !Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1 || settings.timeoutMs > 60_000 || !Number.isInteger(settings.retryDelayMs) || settings.retryDelayMs < 0 || settings.retryDelayMs > 5_000) throw new Error("Invalid timeout or retry limits");
    this.config = { ...config, origin: url.origin, ...settings };
  }

  async request<T>(method: "GET" | "POST" | "PUT", path: string, options: RequestOptions = {}): Promise<Success<T> & { httpStatus: number }> {
    if (!( ["GET", "POST", "PUT"] as string[]).includes(method)) throw new Error("Unsupported method");
    if (!path.startsWith("/") || path.startsWith("//") || /[\r\n#]/u.test(path)) throw new Error("Invalid API path");
    const url = new URL(`${PREFIX}${path}`, this.config.origin);
    const target = url.pathname + url.search;
    if (url.origin !== this.config.origin || !url.pathname.startsWith(`${PREFIX}/`) || target.length > 1024) throw new Error("Invalid API target");
    if (method === "GET" && (options.json !== undefined || options.exactJson !== undefined || options.bytes !== undefined || options.idempotencyKey)) throw new Error("GET must omit body and Idempotency-Key");
    if (method !== "GET" && !/^[A-Za-z0-9._~-]{8,128}$/u.test(options.idempotencyKey ?? "")) throw new Error("Idempotency-Key is required for writes");
    if ([options.json, options.exactJson, options.bytes].filter((value) => value !== undefined).length > 1) throw new Error("Choose one request body");
    if (options.exactJson !== undefined) { try { JSON.parse(options.exactJson); } catch { throw new Error("Exact JSON body is invalid"); } }
    const json = options.exactJson ?? (options.json === undefined ? undefined : JSON.stringify(options.json));
    if (options.json !== undefined && json === undefined) throw new Error("JSON body is not serializable");
    const body = options.bytes === undefined ? Buffer.from(json ?? "", "utf8") : Buffer.from(options.bytes);
    if (body.length > (options.bytes === undefined ? 1024 * 1024 : 8 * 1024 * 1024)) throw new Error("Request body exceeds API limit");
    const uncertain = method !== "GET";
    // A retry budget can improve read-only polling. It never authorizes another write dispatch.
    const retries = method === "GET" ? this.config.maxRetries : 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = randomBytes(16).toString("hex");
      const headers: Record<string, string> = { Accept: "application/json", "X-Publish-Key-Id": this.config.keyId, "X-Publish-Site-Id": this.config.siteId, "X-Publish-Environment": this.config.environment, "X-Publish-Timestamp": String(timestamp), "X-Publish-Nonce": nonce, "X-Publish-Signature": signRequest({ method, target, siteId: this.config.siteId, environment: this.config.environment, timestamp, nonce, body, idempotencyKey: options.idempotencyKey }, this.config.secret) };
      if (method !== "GET") { headers["Idempotency-Key"] = options.idempotencyKey!; headers["Content-Type"] = options.contentType ?? "application/json"; }
      let response: Response;
      let value: unknown;
      try {
        response = await fetch(url, { method, headers, body: method === "GET" ? undefined : body, redirect: "manual", signal: AbortSignal.timeout(this.config.timeoutMs) });
        const raw = await response.text();
        try { value = JSON.parse(raw); } catch { value = null; }
      } catch {
        if (attempt < retries) { await pause(this.delay(attempt)); continue; }
        throw new ClientError(uncertain ? "TRANSPORT_UNCERTAIN" : "TRANSPORT_ERROR", uncertain ? "Write outcome unknown; reconcile with the retained operation key before another operation" : "HTTP request failed or timed out", 0, undefined, undefined, options.idempotencyKey, uncertain);
      }
      if (!value || typeof value !== "object" || !("ok" in value) || !("requestId" in value) || typeof value.requestId !== "string") throw new ClientError("UNEXPECTED_RESPONSE", "Expected a V2 JSON envelope; redirects are not followed", response.status, undefined, undefined, options.idempotencyKey, uncertain);
      if (response.ok && value.ok === true && "data" in value) return { ...(value as Success<T>), httpStatus: response.status };
      if (value.ok !== false || !("error" in value) || !value.error || typeof value.error !== "object" || !("code" in value.error) || !("message" in value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string") throw new ClientError("UNEXPECTED_RESPONSE", "Invalid V2 response shape", response.status, value.requestId, undefined, options.idempotencyKey, uncertain);
      const failure = value as Failure;
      if ([429, 503].includes(response.status) && failure.error.retryable === true && attempt < retries) { await pause(this.delay(attempt)); continue; }
      // Remote error strings may echo signed headers or secret input. Keep bounded codes and fields only.
      const code = /^[A-Z0-9_]{1,64}$/u.test(failure.error.code) && !failure.error.code.includes(this.config.secret) ? failure.error.code : "REMOTE_REJECTED";
      const requestId = /^[A-Za-z0-9-]{1,128}$/u.test(failure.requestId) && !failure.requestId.includes(this.config.secret) ? failure.requestId : undefined;
      const fieldErrors = failure.error.fieldErrors?.filter(item => /^[A-Za-z0-9_.[\]-]{1,100}$/u.test(item.field) && !item.field.includes(this.config.secret))
        .map(item => ({ field: item.field, message: "Field rejected by Publishing API" }));
      throw new ClientError(code, `Publishing API rejected request (${response.status}; ${code})`, response.status, requestId, fieldErrors, options.idempotencyKey, uncertain && response.status >= 500);
    }
    throw new Error("Unreachable retry state");
  }

  private delay(attempt: number): number { return Math.min(this.config.retryDelayMs * 2 ** attempt, 5_000); }
  private contentPath(id: string): string { if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new Error("Invalid content id"); return `/contents/${encodeURIComponent(id)}`; }
  private validateExpectedMedia(expected: Media): void {
    const valid = expected !== null && typeof expected === "object"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(expected.mediaId)
      && /^[a-f0-9]{64}$/u.test(expected.sha256)
      && MEDIA_MIMES.includes(expected.mime)
      && Number.isInteger(expected.bytes) && expected.bytes > 0 && expected.bytes <= MAX_MEDIA_BYTES
      && Number.isInteger(expected.width) && expected.width > 0 && expected.width <= 10_000
      && Number.isInteger(expected.height) && expected.height > 0 && expected.height <= 10_000
      && expected.width * expected.height <= 40_000_000;
    if (!valid) throw new ClientError("INVALID_MEDIA_EXPECTATION", "Invalid expected private media metadata");
  }

  private mediaIntegerHeader(response: Response, name: string): number {
    const raw = response.headers.get(name);
    if (raw === null || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new ClientError("UNEXPECTED_RESPONSE", "Invalid private media response metadata", response.status);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new ClientError("UNEXPECTED_RESPONSE", "Invalid private media response metadata", response.status);
    return value;
  }

  private async cancelMediaBody(response: Response): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
  }

  private async hashMediaBody(response: Response): Promise<{ bytes: number; sha256: string }> {
    if (!response.body) return { bytes: 0, sha256: createHash("sha256").digest("hex") };
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > MAX_MEDIA_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new ClientError("MEDIA_TOO_LARGE", "Private media response exceeds the read limit", response.status);
        }
        hash.update(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    return { bytes, sha256: hash.digest("hex") };
  }

  async verifyPrivateMedia(expected: Media): Promise<{ httpStatus: 200; mediaId: string; sha256: string; bytes: number; mime: string; width: number; height: number }> {
    this.validateExpectedMedia(expected);
    const url = new URL(`${PREFIX}/media/${expected.mediaId}`, this.config.origin);
    const target = url.pathname;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = randomBytes(16).toString("hex");
      const body = Buffer.alloc(0);
      const headers: Record<string, string> = {
        Accept: expected.mime,
        "X-Publish-Key-Id": this.config.keyId,
        "X-Publish-Site-Id": this.config.siteId,
        "X-Publish-Environment": this.config.environment,
        "X-Publish-Timestamp": String(timestamp),
        "X-Publish-Nonce": nonce,
        "X-Publish-Signature": signRequest({ method: "GET", target, siteId: this.config.siteId, environment: this.config.environment, timestamp, nonce, body }, this.config.secret)
      };
      let response: Response;
      try {
        response = await fetch(url, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(this.config.timeoutMs) });
      } catch {
        if (attempt < this.config.maxRetries) { await pause(this.delay(attempt)); continue; }
        throw new ClientError("TRANSPORT_ERROR", "Private media request failed or timed out");
      }

      if ([429, 503].includes(response.status) && attempt < this.config.maxRetries) {
        await this.cancelMediaBody(response);
        await pause(this.delay(attempt));
        continue;
      }
      if ([401, 403].includes(response.status)) {
        await this.cancelMediaBody(response);
        throw new ClientError("AUTH_REJECTED", "Private media read authorization rejected", response.status);
      }
      if (response.status >= 300 && response.status < 400) {
        await this.cancelMediaBody(response);
        throw new ClientError("UNEXPECTED_RESPONSE", "Private media redirect rejected", response.status);
      }
      if (response.status >= 500) {
        await this.cancelMediaBody(response);
        throw new ClientError("REMOTE_ERROR", "Private media service failed", response.status);
      }
      if (response.status !== 200) {
        await this.cancelMediaBody(response);
        throw new ClientError("REMOTE_REJECTED", "Private media read was rejected", response.status);
      }

      const mediaId = response.headers.get("X-Media-Id");
      const sha256 = response.headers.get("X-Media-Sha256");
      const mime = response.headers.get("Content-Type")?.trim().toLowerCase();
      let width: number;
      let height: number;
      let bytes: number;
      let parsedContentLength: number | null;
      try {
        width = this.mediaIntegerHeader(response, "X-Media-Width");
        height = this.mediaIntegerHeader(response, "X-Media-Height");
        bytes = this.mediaIntegerHeader(response, "X-Media-Bytes");
        parsedContentLength = response.headers.has("Content-Length") ? this.mediaIntegerHeader(response, "Content-Length") : null;
      } catch (error) {
        await this.cancelMediaBody(response);
        throw error;
      }
      if (bytes > MAX_MEDIA_BYTES || parsedContentLength !== null && parsedContentLength > MAX_MEDIA_BYTES) {
        await this.cancelMediaBody(response);
        throw new ClientError("MEDIA_TOO_LARGE", "Private media response exceeds the read limit", response.status);
      }
      if (mediaId !== expected.mediaId || sha256 !== expected.sha256 || mime !== expected.mime
        || width !== expected.width || height !== expected.height || bytes !== expected.bytes
        || parsedContentLength !== null && parsedContentLength !== bytes) {
        await this.cancelMediaBody(response);
        throw new ClientError("MEDIA_MISMATCH", "Private media response metadata does not match the expected upload", response.status);
      }

      let actual: { bytes: number; sha256: string };
      try {
        actual = await this.hashMediaBody(response);
      } catch (error) {
        if (error instanceof ClientError) throw error;
        if (attempt < this.config.maxRetries) { await pause(this.delay(attempt)); continue; }
        throw new ClientError("TRANSPORT_ERROR", "Private media response could not be read");
      }
      if (actual.bytes !== bytes || actual.sha256 !== sha256) throw new ClientError("MEDIA_MISMATCH", "Private media body does not match its signed metadata", response.status);
      return { httpStatus: 200, mediaId, sha256, bytes, mime, width, height };
    }
    throw new Error("Unreachable private media retry state");
  }

  capabilities() { return this.request<Capabilities>("GET", "/capabilities"); }
  health() { return this.request<{ status: string; protocolVersion: string }>("GET", "/health"); }
  uploadMedia(bytes: Uint8Array, mime: Media["mime"], idempotencyKey: string) { if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || bytes.length === 0) throw new Error("Invalid media type or empty image"); return this.request<Media>("POST", "/media", { bytes, contentType: mime, idempotencyKey }); }
  createContent(json: CreateContent, idempotencyKey: string) { return this.request<CmsRecord>("POST", "/contents", { json, idempotencyKey }); }
  listContents(filters: { kind?: "article" | "case"; externalId?: string; status?: "active" | "published" | "deleted"; page?: number; pageSize?: number } = {}) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.append(key, String(value)); return this.request<ContentList>("GET", `/contents${query.size ? `?${query}` : ""}`); }
  getContent(id: string) { return this.request<CmsRecord>("GET", this.contentPath(id)); }
  saveDraft(id: string, json: SaveDraft, idempotencyKey: string) { return this.request<CmsRecord>("PUT", `${this.contentPath(id)}/draft`, { json, idempotencyKey }); }
  validate(id: string, revisionId: string, idempotencyKey: string) { return this.request<Validation>("POST", `${this.contentPath(id)}/validate`, { json: { revisionId }, idempotencyKey }); }
  publish(id: string, json: Publish, idempotencyKey: string) { return this.request<Job>("POST", `${this.contentPath(id)}/publish`, { json, idempotencyKey }); }
  unpublish(id: string, json: ExpectedPublished, idempotencyKey: string) { return this.request<Job>("POST", `${this.contentPath(id)}/unpublish`, { json, idempotencyKey }); }
  rollback(id: string, json: Rollback, idempotencyKey: string) { return this.request<Job>("POST", `${this.contentPath(id)}/rollback`, { json, idempotencyKey }); }
  deleteContent(id: string, json: DeleteContent, idempotencyKey: string) { return this.request<Job>("POST", `${this.contentPath(id)}/delete`, { json, idempotencyKey }); }
  restore(id: string, rowVersion: number, idempotencyKey: string) { return this.request<Job>("POST", `${this.contentPath(id)}/restore`, { json: { rowVersion }, idempotencyKey }); }
  purge(id: string, json: Purge, idempotencyKey: string) { return this.request<Job>("POST", `${this.contentPath(id)}/purge`, { json, idempotencyKey }); }
  getJob(id: string) { if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new Error("Invalid job id"); return this.request<Job>("GET", `/jobs/${encodeURIComponent(id)}`); }
  async waitForJob(id: string, options: { maxPolls?: number; intervalMs?: number } = {}): Promise<Success<Job>> { const maxPolls = options.maxPolls ?? 60; const intervalMs = options.intervalMs ?? 1_000; if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 600 || !Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 10_000) throw new Error("Invalid polling bounds"); for (let index = 0; index < maxPolls; index += 1) { const job = await this.getJob(id); if (["succeeded", "failed", "needs_attention"].includes(job.data.status)) return job; if (!["queued", "processing", "verifying"].includes(job.data.status)) throw new ClientError("UNEXPECTED_RESPONSE", "Unknown job status"); if (index + 1 < maxPolls) await pause(intervalMs); } throw new ClientError("POLL_LIMIT", `Job ${id} is still pending; query the same job again`, 0, undefined, undefined, undefined, true); }
}
