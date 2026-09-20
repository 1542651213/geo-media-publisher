import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Capabilities, CmsRecord, ContentList, CreateContent, DeleteContent, DeployEnvironment, ExpectedPublished, Failure, FieldError, Job, Media, Publish, Purge, Rollback, SaveDraft, Success, Validation } from "./contracts";

const PREFIX = "/_publish-api/v2";
const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface SigningInput { method: string; target: string; siteId: string; environment: DeployEnvironment; timestamp: number; nonce: string; idempotencyKey?: string; body: Uint8Array }

/** Canonical signing contract mirrored from Kangyi clients/cms-v2/client.ts. */
export function signRequest(input: SigningInput, secret: string): string {
  const canonical = [input.method.toUpperCase(), input.target, input.siteId, input.environment, String(input.timestamp), input.nonce, input.idempotencyKey ?? "", createHash("sha256").update(input.body).digest("hex")].join("\n");
  return `sha256=${createHmac("sha256", Buffer.from(secret, "utf8")).update(canonical, "utf8").digest("hex")}`;
}

export interface ClientConfig { origin: string; siteId: string; environment: DeployEnvironment; keyId: string; secret: string; timeoutMs?: number; maxRetries?: number; retryDelayMs?: number }
export interface RequestOptions { json?: unknown; bytes?: Uint8Array; contentType?: string; idempotencyKey?: string }

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
    const settings = { timeoutMs: config.timeoutMs ?? 10_000, maxRetries: config.maxRetries ?? 2, retryDelayMs: config.retryDelayMs ?? 250 };
    if (!Number.isInteger(settings.maxRetries) || settings.maxRetries < 0 || settings.maxRetries > 5 || !Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1 || settings.timeoutMs > 60_000 || !Number.isInteger(settings.retryDelayMs) || settings.retryDelayMs < 0 || settings.retryDelayMs > 5_000) throw new Error("Invalid timeout or retry limits");
    this.config = { ...config, origin: url.origin, ...settings };
  }

  async request<T>(method: "GET" | "POST" | "PUT", path: string, options: RequestOptions = {}): Promise<Success<T>> {
    if (!( ["GET", "POST", "PUT"] as string[]).includes(method)) throw new Error("Unsupported method");
    if (!path.startsWith("/") || path.startsWith("//") || /[\r\n#]/u.test(path)) throw new Error("Invalid API path");
    const url = new URL(`${PREFIX}${path}`, this.config.origin);
    const target = url.pathname + url.search;
    if (url.origin !== this.config.origin || !url.pathname.startsWith(`${PREFIX}/`) || target.length > 1024) throw new Error("Invalid API target");
    if (method === "GET" && (options.json !== undefined || options.bytes !== undefined || options.idempotencyKey)) throw new Error("GET must omit body and Idempotency-Key");
    if (method !== "GET" && !/^[A-Za-z0-9._~-]{8,128}$/u.test(options.idempotencyKey ?? "")) throw new Error("Idempotency-Key is required for writes");
    if (options.json !== undefined && options.bytes !== undefined) throw new Error("Choose json or bytes");
    const json = options.json === undefined ? undefined : JSON.stringify(options.json);
    if (options.json !== undefined && json === undefined) throw new Error("JSON body is not serializable");
    const body = options.bytes === undefined ? Buffer.from(json ?? "", "utf8") : Buffer.from(options.bytes);
    if (body.length > (options.bytes === undefined ? 1024 * 1024 : 8 * 1024 * 1024)) throw new Error("Request body exceeds API limit");
    const uncertain = method !== "GET";
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
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
        if (attempt < this.config.maxRetries) { await pause(this.delay(attempt)); continue; }
        throw new ClientError(uncertain ? "TRANSPORT_UNCERTAIN" : "TRANSPORT_ERROR", uncertain ? "Write outcome unknown; reconcile with the retained operation key before another operation" : "HTTP request failed or timed out", 0, undefined, undefined, options.idempotencyKey, uncertain);
      }
      if (!value || typeof value !== "object" || !("ok" in value) || !("requestId" in value) || typeof value.requestId !== "string") throw new ClientError("UNEXPECTED_RESPONSE", "Expected a V2 JSON envelope; redirects are not followed", response.status, undefined, undefined, options.idempotencyKey, uncertain);
      if (response.ok && value.ok === true && "data" in value) return value as Success<T>;
      if (value.ok !== false || !("error" in value) || !value.error || typeof value.error !== "object" || !("code" in value.error) || !("message" in value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string") throw new ClientError("UNEXPECTED_RESPONSE", "Invalid V2 response shape", response.status, value.requestId, undefined, options.idempotencyKey, uncertain);
      const failure = value as Failure;
      if ([429, 503].includes(response.status) && failure.error.retryable === true && attempt < this.config.maxRetries) { await pause(this.delay(attempt)); continue; }
      throw new ClientError(failure.error.code, failure.error.message, response.status, failure.requestId, failure.error.fieldErrors, options.idempotencyKey, uncertain && response.status >= 500);
    }
    throw new Error("Unreachable retry state");
  }

  private delay(attempt: number): number { return Math.min(this.config.retryDelayMs * 2 ** attempt, 5_000); }
  private contentPath(id: string): string { if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new Error("Invalid content id"); return `/contents/${encodeURIComponent(id)}`; }
  capabilities() { return this.request<Capabilities>("GET", "/capabilities"); }
  uploadMedia(bytes: Uint8Array, mime: Media["mime"], idempotencyKey: string) { if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || bytes.length === 0) throw new Error("Invalid media type or empty image"); return this.request<Media>("POST", "/media", { bytes, contentType: mime, idempotencyKey }); }
  createContent(json: CreateContent, idempotencyKey: string) { return this.request<CmsRecord>("POST", "/contents", { json, idempotencyKey }); }
  listContents(filters: { kind?: "article" | "case"; externalId?: string; status?: "draft" | "published" | "deleted"; page?: number; pageSize?: number } = {}) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.append(key, String(value)); return this.request<ContentList>("GET", `/contents${query.size ? `?${query}` : ""}`); }
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
