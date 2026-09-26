import { createHash } from "node:crypto";
import { CmsV2Client, type ClientConfig, type CmsRecord, type Job, type Publish, type Validation } from "@publisher/cms-v2-client";
import type { KangyiContentTransportResult, KangyiDurableOperationTransport, KangyiJobTransportResult } from "./kangyi-durable-operation";

function parseExact<T>(body: string): T {
  return JSON.parse(body) as T;
}

function contentIdentity(record: CmsRecord): KangyiContentTransportResult {
  return { contentId: record.id, revisionId: record.revisionId, rowVersion: record.rowVersion, contentHash: record.contentHash };
}

function metaContent(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const attributes = new Map(Array.from(tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gu), (match) => [match[1]!.toLowerCase(), match[3]!]));
    if (attributes.get("name") === name) return attributes.get("content") ?? null;
  }
  return null;
}

/** CMS V2 transport shared by all staging website accounts. It delegates every signed call to CmsV2Client. */
export class CmsV2OperationTransport implements KangyiDurableOperationTransport {
  private readonly client: CmsV2Client;
  private readonly origin: string;
  private readonly siteId: string;

  constructor(config: ClientConfig) {
    if (config.environment !== "staging" || !["kangyi", "huiquan", "shupai"].includes(config.siteId)) throw new Error("WEBSITE_STAGING_SCOPE_REQUIRED");
    this.client = new CmsV2Client({ ...config, maxRetries: 0 });
    this.origin = new URL(config.origin).origin;
    this.siteId = config.siteId;
  }

  async uploadMedia(input: Parameters<KangyiDurableOperationTransport["uploadMedia"]>[0]) {
    return (await this.client.uploadMedia(input.bytes, input.mime, input.idempotencyKey)).data;
  }

  async createContent(input: Parameters<KangyiDurableOperationTransport["createContent"]>[0]) {
    const response = await this.client.request<CmsRecord>("POST", "/contents", { exactJson: input.exactRequestBody, idempotencyKey: input.idempotencyKey });
    if (response.httpStatus !== 201) throw new Error("CMS_CREATE_STATUS_UNEXPECTED");
    if (response.data.siteId !== this.siteId || response.data.environment !== "staging") throw new Error("CMS_CONTENT_SCOPE_MISMATCH");
    return contentIdentity(response.data);
  }

  async saveDraft(input: Parameters<KangyiDurableOperationTransport["saveDraft"]>[0]) {
    const response = await this.client.request<CmsRecord>("PUT", `/contents/${encodeURIComponent(input.contentId)}/draft`, { exactJson: input.exactRequestBody, idempotencyKey: input.idempotencyKey });
    if (response.httpStatus !== 200) throw new Error("CMS_DRAFT_STATUS_UNEXPECTED");
    if (response.data.id !== input.contentId || response.data.siteId !== this.siteId || response.data.environment !== "staging") throw new Error("CMS_CONTENT_SCOPE_MISMATCH");
    return contentIdentity(response.data);
  }

  async validate(input: Parameters<KangyiDurableOperationTransport["validate"]>[0]) {
    const response = await this.client.request<Validation>("POST", `/contents/${encodeURIComponent(input.contentId)}/validate`, { exactJson: input.exactRequestBody, idempotencyKey: input.idempotencyKey });
    if (response.httpStatus !== 200 || response.data.contentId !== input.contentId) throw new Error("CMS_VALIDATION_IDENTITY_MISMATCH");
    return { valid: response.data.valid, revisionId: response.data.revisionId, contentHash: response.data.contentHash };
  }

  async publish(input: Parameters<KangyiDurableOperationTransport["publish"]>[0]) {
    const expected = parseExact<Publish>(input.exactRequestBody);
    const response = await this.client.request<Job>("POST", `/contents/${encodeURIComponent(input.contentId)}/publish`, { exactJson: input.exactRequestBody, idempotencyKey: input.idempotencyKey });
    if (response.data.siteId !== this.siteId || response.data.environment !== "staging" || response.data.contentId !== input.contentId) throw new Error("CMS_JOB_SCOPE_MISMATCH");
    // The queued job DTO omits rowVersion; echo the immutable request precondition after server acceptance.
    return { httpStatus: response.httpStatus, jobId: response.data.jobId, contentId: response.data.contentId, revisionId: response.data.revisionId ?? "", rowVersion: expected.rowVersion, contentHash: response.data.contentHash ?? "" };
  }

  async getJob(jobId: string): Promise<KangyiJobTransportResult> {
    const response = await this.client.getJob(jobId);
    const job = response.data;
    if (job.siteId !== this.siteId || job.environment !== "staging" || job.jobId !== jobId) throw new Error("CMS_JOB_SCOPE_MISMATCH");
    return { jobId: job.jobId, status: job.status, publicUrl: job.publicUrl, verification: job.verification };
  }

  async verifyPublic(input: Parameters<KangyiDurableOperationTransport["verifyPublic"]>[0]) {
    const url = new URL(input.publicUrl);
    if (url.origin !== this.origin || !/^\/(news|cases)\/[a-z0-9-]+\/$/u.test(url.pathname) || url.search || url.hash) throw new Error("CMS_PUBLIC_URL_SCOPE_MISMATCH");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) throw new Error("CMS_PUBLIC_READBACK_NOT_200_HTML");
    const html = await response.text();
    const contentId = metaContent(html, "cms-content-id");
    const revisionId = metaContent(html, "cms-revision-id");
    const contentHash = metaContent(html, "cms-content-hash");
    if (contentId !== input.contentId || revisionId !== input.revisionId || contentHash !== input.contentHash) throw new Error("PUBLIC_READBACK_MISMATCH");
    for (const media of input.media) {
      if (!/^[0-9a-f-]{36}$/iu.test(media.mediaId) || !/^[0-9a-f]{64}$/iu.test(media.sha256)) throw new Error("CMS_PUBLIC_MEDIA_IDENTITY_INVALID");
      const mediaUrl = new URL(`/media/${media.mediaId}`, this.origin);
      const mediaResponse = await fetch(mediaUrl, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (mediaResponse.status !== 200 || createHash("sha256").update(Buffer.from(await mediaResponse.arrayBuffer())).digest("hex") !== media.sha256) throw new Error("CMS_PUBLIC_MEDIA_READBACK_MISMATCH");
    }
    return { ok: true, contentId, publicUrl: url.href, response: { status: response.status, contentId, revisionId, contentHash, mediaCount: input.media.length } };
  }
}
