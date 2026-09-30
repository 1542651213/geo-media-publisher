import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import { ClientError, type Capabilities, type CmsRecord, type Job, type Media, type Validation } from "../../../cms-v2-client/src";
import { prepareOfficialApiContent, type OfficialApiPreparedContent } from "./mapping";
import {
  OfficialApiDurableRuntime,
  type OfficialApiOperation,
  type OfficialApiOperationStore,
  type OfficialApiRuntimeClient
} from "./runtime";

class MemoryStore implements OfficialApiOperationStore {
  readonly records = new Map<string, OfficialApiOperation>();
  insert(operation: OfficialApiOperation): OfficialApiOperation {
    if ([...this.records.values()].some(item => item.accountId === operation.accountId && item.articleId === operation.articleId))
      throw new Error("OFFICIAL_API_SOURCE_ALREADY_BOUND");
    this.records.set(operation.jobId, structuredClone(operation));
    return structuredClone(operation);
  }
  getByJobId(jobId: string): OfficialApiOperation | null { return structuredClone(this.records.get(jobId) ?? null); }
  findBySource(accountId: string, articleId: string): OfficialApiOperation | null {
    return structuredClone([...this.records.values()].find(item => item.accountId === accountId && item.articleId === articleId) ?? null);
  }
  compareAndSwap(jobId: string, expectedRevision: number, next: OfficialApiOperation): OfficialApiOperation {
    const current = this.records.get(jobId);
    if (!current || current.revision !== expectedRevision) throw new Error("OFFICIAL_API_OPERATION_CONCURRENT_UPDATE");
    const stored = structuredClone({ ...next, revision: expectedRevision + 1 });
    this.records.set(jobId, stored);
    return structuredClone(stored);
  }
}

const scope = { accountId: "account-one", siteId: "kangyi", environment: "staging" as const, keyId: "staging-editor" };
const source = { articleId: "article-one", brandId: "brand-one", title: "正式官网测试", summary: "正式官网测试摘要",
  body: "第一段正文。", tags: ["官网"], seoKeywords: ["正式"], articleType: "治理常识", city: "南京" };
const bytes = Buffer.from("fixture-image");
const image = { assetId: "cover", brandId: "brand-one", filePath: "D:/fixture/cover.png",
  sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png" as const,
  bytes: bytes.length, width: 10, height: 10, alt: "封面" };
const prepared = (): OfficialApiPreparedContent => prepareOfficialApiContent({ source, scope, images: [image],
  settings: { version: 1, kind: "article", coverAssetId: "cover" } });
const context = (jobId = "job-one"): AccountContext => ({ accountId: scope.accountId, accountName: "官网",
  platformKey: "website", settings: { publishJobId: jobId } });
function remoteRecord(draft: OfficialApiPreparedContent["draftPreview"] | Record<string, unknown>, rowVersion = 1): CmsRecord {
  return { id: "10000000-0000-4000-a000-000000000001", contentId: "10000000-0000-4000-a000-000000000001",
    revisionId: "20000000-0000-4000-a000-000000000001", contentHash: "a".repeat(64), rowVersion,
    siteId: "kangyi", environment: "staging", kind: "article", slug: "fixture", externalId: "pending",
    principalId: scope.keyId, draftRevisionId: "20000000-0000-4000-a000-000000000001", publishedRevisionId: null,
    deletedAt: null, draft: draft as CmsRecord["draft"] };
}
function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .reverse().map(([key, item]) => [key, reverseObjectKeys(item)]));
  return value;
}

function client(overrides: Partial<OfficialApiRuntimeClient> = {}): OfficialApiRuntimeClient {
  const media: Media = { mediaId: "30000000-0000-4000-a000-000000000001", sha256: image.sha256,
    mime: image.mimeType, width: image.width, height: image.height, bytes: image.bytes };
  let current = remoteRecord({});
  const base: OfficialApiRuntimeClient = {
    health: vi.fn(async () => ({ ok: true as const, requestId: "request-health", httpStatus: 200,
      data: { status: "ok", protocolVersion: "2" } })),
    capabilities: vi.fn(async () => ({ ok: true as const, requestId: "request-capabilities", httpStatus: 200,
      data: { siteId: "kangyi", environment: "staging", protocolVersion: "2", contentKinds: ["article", "case"],
        writesEnabled: true, limits: { jsonBytes: 1_048_576, mediaBytes: 8_388_608, imagePixels: 40_000_000, imageDimension: 10_000 } } satisfies Capabilities })),
    uploadMedia: vi.fn(async () => ({ ok: true as const, requestId: "request-media", httpStatus: 201, data: media })),
    verifyPrivateMedia: vi.fn(async () => ({ httpStatus: 200 as const, ...media })),
    request: vi.fn(async (_method, path, options) => {
      const body = JSON.parse(options.exactJson ?? "{}") as { draft?: CmsRecord["draft"]; externalId?: string };
      if (path.endsWith("/validate")) return { ok: true as const, requestId: "request-validate", httpStatus: 200,
        data: { valid: true, contentId: "10000000-0000-4000-a000-000000000001",
          revisionId: "20000000-0000-4000-a000-000000000001", contentHash: "a".repeat(64) } as never };
      if (path.endsWith("/publish")) return { ok: true as const, requestId: "request-publish", httpStatus: 202,
        data: { jobId: "40000000-0000-4000-a000-000000000001", operation: "publish", siteId: "kangyi",
          environment: "staging", contentId: "10000000-0000-4000-a000-000000000001",
          revisionId: "20000000-0000-4000-a000-000000000001", contentHash: "a".repeat(64), status: "queued",
          publicUrl: null, previousRevisionId: null, verification: null, error: null,
          createdAt: new Date(0).toISOString(), finishedAt: null } as never };
      if (path.endsWith("/draft")) {
        current = { ...current, draft: body.draft ?? current.draft };
        return { ok: true as const, requestId: "request-draft", httpStatus: 200, data: current as never };
      }
      const requestDraft = body.draft ?? current.draft;
      current = { ...remoteRecord(requestDraft), externalId: body.externalId ?? null, draft: requestDraft };
      return { ok: true as const, requestId: "request-create", httpStatus: 201, data: current as never };
    }),
    listContents: vi.fn(async () => ({ ok: true as const, requestId: "request-list", httpStatus: 200,
      data: { items: [], total: 0, page: 1, pageSize: 20 } })),
    getContent: vi.fn(async () => ({ ok: true as const, requestId: "request-content", httpStatus: 200, data: current })),
    validate: vi.fn(async (_id, revisionId) => ({ ok: true as const, requestId: "request-validate", httpStatus: 200,
      data: { valid: true, contentId: "10000000-0000-4000-a000-000000000001", revisionId,
        contentHash: "a".repeat(64) } satisfies Validation })),
    getJob: vi.fn(async () => ({ ok: true as const, requestId: "request-job", httpStatus: 200,
      data: { jobId: "40000000-0000-4000-a000-000000000001", operation: "publish", siteId: "kangyi",
        environment: "staging", contentId: "10000000-0000-4000-a000-000000000001",
        revisionId: "20000000-0000-4000-a000-000000000001", contentHash: "a".repeat(64), status: "succeeded",
        publicUrl: `https://staging.kangyihb.com/news/${prepared().slug}/`, previousRevisionId: null,
        verification: { ok: true }, error: null, createdAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString() } satisfies Job })),
  };
  return { ...base, ...overrides };
}

function runtime(store: MemoryStore, api: OfficialApiRuntimeClient, allowedBindings: Array<{ accountId: string; articleId: string; contentBindingId: string }> | undefined = undefined) {
  return new OfficialApiDurableRuntime({ operationStore: store, clientFactory: () => api,
    readMediaBytes: async () => bytes, formalExecution: { available: true, allowedBindings },
    publicVerifier: async () => ({ ok: false, warning: "PUBLIC_FIDELITY_MISMATCH", evidence: { status: 200 } }) });
}

describe("OfficialAPI durable runtime", () => {
  it("persists frozen binding, operation keys, exact JSON, and remote identities before advancing to PREPARED", async () => {
    const store = new MemoryStore(); const api = client(); const frozen = prepared();
    const result = await runtime(store, api, [{ accountId: scope.accountId, articleId: source.articleId,
      contentBindingId: frozen.contentBindingId }]).prepare(context(), frozen, "job-one");
    expect(result.status).toBe("prepared");
    const saved = store.getByJobId("job-one")!;
    expect(saved).toMatchObject({ phase: "PREPARED", accountId: scope.accountId, articleId: source.articleId,
      sourceHash: frozen.sourceHash, contentBindingId: frozen.contentBindingId });
    expect(saved.media[0]).toMatchObject({ assetId: "cover", state: "SUCCEEDED", remote: { sha256: image.sha256 } });
    expect(saved.create).toMatchObject({ state: "SUCCEEDED", exactJson: expect.any(String), idempotencyKey: expect.any(String) });
    expect(saved.draft).toMatchObject({ state: "SUCCEEDED", exactJson: expect.any(String), idempotencyKey: expect.any(String) });
    expect(saved.validate).toMatchObject({ state: "SUCCEEDED", exactJson: expect.any(String), idempotencyKey: expect.any(String) });
    expect(saved.remoteContent).toMatchObject({ contentId: "10000000-0000-4000-a000-000000000001",
      revisionId: "20000000-0000-4000-a000-000000000001", rowVersion: 1, contentHash: "a".repeat(64) });
    expect(api.verifyPrivateMedia).toHaveBeenCalledTimes(1);
  });

  it("accepts semantically identical server JSON whose nested object keys were reordered", async () => {
    const store = new MemoryStore(); const api = client(); const normalRequest = api.request; const normalGet = api.getContent;
    api.request = vi.fn(async (method, path, options) => {
      const response = await normalRequest(method, path, options);
      if (path.endsWith("/validate") || path.endsWith("/publish")) return response;
      const record = response.data as CmsRecord;
      return { ...response, data: { ...record, draft: reverseObjectKeys(record.draft) } as never };
    }) as OfficialApiRuntimeClient["request"];
    api.getContent = vi.fn(async id => {
      const response = await normalGet(id);
      return { ...response, data: { ...response.data, draft: reverseObjectKeys(response.data.draft) as CmsRecord["draft"] } };
    });
    await expect(runtime(store, api).prepare(context(), prepared(), "job-one")).resolves.toMatchObject({ status: "prepared" });
  });

  it("keeps a successful create with mismatched response binding uncertain for exact reconciliation", async () => {
    const store = new MemoryStore(); const api = client(); const normalRequest = api.request;
    api.request = vi.fn(async (method, path, options) => {
      const response = await normalRequest(method, path, options);
      if (path !== "/contents") return response;
      return { ...response, data: { ...(response.data as CmsRecord), principalId: "another-key" } as never };
    }) as OfficialApiRuntimeClient["request"];
    await expect(runtime(store, api).prepare(context(), prepared(), "job-one")).rejects.toThrow("CONTENT_RESPONSE_MISMATCH");
    expect(store.getByJobId("job-one")).toMatchObject({ phase: "NEEDS_RECONCILIATION", create: { state: "OUTCOME_UNKNOWN" } });
  });

  it("rejects an unlisted Candidate binding before reading media or calling the API", async () => {
    const store = new MemoryStore(); const api = client(); const readMediaBytes = vi.fn(async () => bytes);
    const durable = new OfficialApiDurableRuntime({ operationStore: store, clientFactory: () => api, readMediaBytes,
      formalExecution: { available: true, allowedBindings: [] } });
    await expect(durable.prepare(context(), prepared(), "job-one")).rejects.toThrow("BINDING_NOT_AUTHORIZED");
    expect(readMediaBytes).not.toHaveBeenCalled(); expect(api.uploadMedia).not.toHaveBeenCalled();
  });

  it("leaves uncertain media in reconciliation and never uploads it again", async () => {
    const store = new MemoryStore();
    const uploadMedia = vi.fn(async () => { throw new ClientError("TRANSPORT_UNCERTAIN", "unknown", 0, undefined, undefined, "key", true); });
    const api = client({ uploadMedia }); const durable = runtime(store, api);
    await expect(durable.prepare(context(), prepared(), "job-one")).rejects.toMatchObject({ code: "TRANSPORT_UNCERTAIN" });
    expect(store.getByJobId("job-one")).toMatchObject({ phase: "NEEDS_RECONCILIATION", media: [{ state: "OUTCOME_UNKNOWN" }] });
    await expect(durable.recoverOriginalOperation(context(), "job-one")).resolves.toMatchObject({ status: "needs_reconciliation" });
    expect(uploadMedia).toHaveBeenCalledTimes(1);
  });

  it("persists a successful media upload identity before private verification and recovers with GET only", async () => {
    const store = new MemoryStore(); let verificationAttempt = 0;
    const verifyPrivateMedia = vi.fn(async (expected: Media) => {
      verificationAttempt += 1;
      if (verificationAttempt === 1)
        throw new ClientError("TRANSPORT_UNCERTAIN", "unknown private read", 0, undefined, undefined, undefined, true);
      return { httpStatus: 200 as const, ...expected };
    });
    const api = client({ verifyPrivateMedia }); const durable = runtime(store, api);
    await expect(durable.prepare(context(), prepared(), "job-one")).rejects.toMatchObject({ code: "TRANSPORT_UNCERTAIN" });
    expect(store.getByJobId("job-one")).toMatchObject({ phase: "NEEDS_RECONCILIATION",
      media: [{ state: "OUTCOME_UNKNOWN", remote: { mediaId: "30000000-0000-4000-a000-000000000001", sha256: image.sha256 } }] });
    await expect(durable.recoverOriginalOperation(context(), "job-one")).resolves.toMatchObject({ status: "prepared" });
    expect(api.uploadMedia).toHaveBeenCalledTimes(1);
    expect(verifyPrivateMedia.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("recovers an unknown create only from one exact externalId/principal/scope/kind/full-draft match", async () => {
    const store = new MemoryStore(); let createdDraft: CmsRecord["draft"] | undefined; let externalId = "";
    const api = client(); const normalRequest = api.request;
    const request = vi.fn(async (method: "GET" | "POST" | "PUT", path: string, options: { exactJson?: string; idempotencyKey?: string }) => {
      const value = JSON.parse(options.exactJson ?? "{}") as { draft: CmsRecord["draft"]; externalId: string };
      if (path === "/contents") {
        createdDraft = value.draft; externalId = value.externalId;
        throw new ClientError("TRANSPORT_UNCERTAIN", "unknown", 0, undefined, undefined, "key", true);
      }
      return normalRequest(method, path, options);
    });
    api.request = request as OfficialApiRuntimeClient["request"]; const durable = runtime(store, api);
    await expect(durable.prepare(context(), prepared(), "job-one")).rejects.toMatchObject({ code: "TRANSPORT_UNCERTAIN" });
    const recoveredRecord = { ...remoteRecord(createdDraft!), externalId, draft: createdDraft! };
    api.listContents = vi.fn(async () => ({ ok: true as const, requestId: "request-list", httpStatus: 200,
      data: { items: [recoveredRecord], total: 1, page: 1, pageSize: 20 } }));
    api.request = vi.fn(async (_method, path) => path.endsWith("/draft")
      ? { ok: true as const, requestId: "request-draft", httpStatus: 200, data: recoveredRecord as never }
      : { ok: true as const, requestId: "request-validate", httpStatus: 200, data: { valid: true,
          contentId: recoveredRecord.id, revisionId: recoveredRecord.revisionId, contentHash: recoveredRecord.contentHash } as never }) as OfficialApiRuntimeClient["request"];
    api.getContent = vi.fn(async () => ({ ok: true as const, requestId: "request-content", httpStatus: 200, data: recoveredRecord }));
    await expect(durable.recoverOriginalOperation(context(), "job-one")).resolves.toMatchObject({ status: "prepared" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(store.getByJobId("job-one")?.create?.state).toBe("SUCCEEDED");
  });

  it("claims the existing SubmissionIntent immediately before the sole publish HTTP and then polls only the saved job", async () => {
    const store = new MemoryStore(); const events: string[] = [];
    const api = client(); const originalRequest = api.request;
    api.request = vi.fn(async (method, path, options) => {
      if (path.endsWith("/publish")) events.push("http");
      return originalRequest(method, path, options);
    }) as OfficialApiRuntimeClient["request"];
    const durable = runtime(store, api); await durable.prepare(context(), prepared(), "job-one");
    const frozenArticle = durable.getPreparedArticleInput(context());
    await durable.prepareFinalSubmit(context(), frozenArticle);
    const result = await durable.finalSubmit(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent-one", attempt: 1,
      markSubmissionSideEffect: () => events.push("claim") });
    expect(events).toEqual(["claim", "http"]); expect(result.status).toBe("publishing");
    expect(result.response).toMatchObject({ contentId: "10000000-0000-4000-a000-000000000001",
      revisionId: "20000000-0000-4000-a000-000000000001", contentHash: "a".repeat(64), rowVersion: 1,
      remoteJobId: "40000000-0000-4000-a000-000000000001" });
    expect(store.getByJobId("job-one")).toMatchObject({ phase: "PUBLISH_ACCEPTED", publish: { state: "SUCCEEDED" },
      remoteJob: { jobId: "40000000-0000-4000-a000-000000000001" } });
    await durable.collectPublishResult(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent-one", attempt: 1 });
    await durable.collectPublishResult(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent-one", attempt: 2 });
    expect(vi.mocked(api.request).mock.calls.filter(([, path]) => path.endsWith("/publish"))).toHaveLength(1);
    expect(api.getJob).toHaveBeenCalledTimes(2);
  });

  it("treats a scoped succeeded API job with trusted URL as Published and records public fidelity as an independent warning", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozenArticle = durable.getPreparedArticleInput(context());
    await durable.finalSubmit(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent-one", attempt: 1,
      markSubmissionSideEffect: vi.fn() });
    const result = await durable.collectPublishResult(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent-one", attempt: 1 });
    expect(result).toMatchObject({ success: true, status: "published", externalId: "10000000-0000-4000-a000-000000000001",
      publishedUrl: `https://staging.kangyihb.com/news/${prepared().slug}/`, response: { publicFidelity: "WARNING",
        remoteJobId: "40000000-0000-4000-a000-000000000001", rowVersion: 1 } });
    expect(store.getByJobId("job-one")).toMatchObject({ phase: "PUBLISHED", fidelity: { ok: false, warning: "PUBLIC_FIDELITY_MISMATCH" } });
  });

  it("recovers an uncertain draft from a strictly newer exact remote draft without a second PUT", async () => {
    const store = new MemoryStore(); const api = client(); const normalRequest = api.request;
    let latest: CmsRecord | null = null; let draftCalls = 0;
    api.request = vi.fn(async (method, path, options) => {
      if (!path.endsWith("/draft")) return normalRequest(method, path, options);
      draftCalls += 1;
      const body = JSON.parse(options.exactJson ?? "{}") as { draft: CmsRecord["draft"] };
      latest = { ...remoteRecord(body.draft, 2), externalId: store.getByJobId("job-one")!.externalId, draft: body.draft };
      throw new ClientError("TRANSPORT_UNCERTAIN", "unknown", 0, undefined, undefined, options.idempotencyKey, true);
    }) as OfficialApiRuntimeClient["request"];
    api.getContent = vi.fn(async () => ({ ok: true as const, requestId: "request-content", httpStatus: 200, data: latest! }));
    const durable = runtime(store, api);
    await expect(durable.prepare(context(), prepared(), "job-one")).rejects.toMatchObject({ code: "TRANSPORT_UNCERTAIN" });
    api.request = vi.fn(async (_method, path) => ({ ok: true as const, requestId: "request-validate", httpStatus: 200,
      data: path.endsWith("/validate") ? { valid: true, contentId: latest!.id, revisionId: latest!.revisionId,
        contentHash: latest!.contentHash } as never : latest as never })) as OfficialApiRuntimeClient["request"];
    await expect(durable.recoverOriginalOperation(context(), "job-one")).resolves.toMatchObject({ status: "prepared" });
    expect(draftCalls).toBe(1);
  });

  it("polls a saved maintenance job on restart and never substitutes the original publish job", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozenArticle = durable.getPreparedArticleInput(context());
    await durable.finalSubmit(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: vi.fn() });
    await durable.collectPublishResult(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1 });
    const published = { ...remoteRecord(store.getByJobId("job-one")!.prepared.draftPreview, 2),
      externalId: store.getByJobId("job-one")!.externalId, publishedRevisionId: "20000000-0000-4000-a000-000000000001" };
    api.getContent = vi.fn(async () => ({ ok: true as const, requestId: "request-content", httpStatus: 200, data: published }));
    const normalRequest = api.request;
    api.request = vi.fn(async (method, path, options) => path.endsWith("/unpublish")
      ? { ok: true as const, requestId: "request-maintenance", httpStatus: 202, data: {
          ...(await api.getJob("ignored")).data, jobId: "50000000-0000-4000-a000-000000000001", operation: "unpublish",
          contentId: published.id, revisionId: published.revisionId, contentHash: published.contentHash, status: "queued", publicUrl: null } as never }
      : normalRequest(method, path, options)) as OfficialApiRuntimeClient["request"];
    await durable.maintainOwnContent(context(), { jobId: "job-one", operation: "unpublish" });
    const maintenanceRequests = () => vi.mocked(api.request).mock.calls.filter(([, path]) => path.endsWith("/unpublish")).length;
    expect(maintenanceRequests()).toBe(1);
    const maintenanceGetJob: OfficialApiRuntimeClient["getJob"] = async jobId => ({ ok: true, requestId: "request-job", httpStatus: 200, data: {
      ...(await client().getJob(jobId)).data, jobId, operation: "unpublish", contentId: published.id, status: "succeeded", publicUrl: null } });
    api.getJob = vi.fn(maintenanceGetJob);
    api.getContent = vi.fn(async () => ({ ok: true as const, requestId: "request-content", httpStatus: 200,
      data: { ...published, rowVersion: 3, publishedRevisionId: null } }));
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "unpublish" }))
      .resolves.toMatchObject({ status: "maintained", operation: { maintenance: [{ remoteJob: { status: "succeeded" } }] } });
    expect(maintenanceRequests()).toBe(1);
  });

  it("refuses maintenance for prepared content that has no accepted original publish job", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one");
    vi.mocked(api.request).mockClear(); vi.mocked(api.getContent).mockClear();
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "delete" }))
      .rejects.toThrow("ORIGINAL_PUBLISH_REQUIRED");
    expect(api.request).not.toHaveBeenCalled(); expect(api.getContent).not.toHaveBeenCalled();
  });

  it("keeps a journaled PLANNED maintenance action unresolved across recovery and a different requested action", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozenArticle = durable.getPreparedArticleInput(context());
    await durable.finalSubmit(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: vi.fn() });
    await durable.collectPublishResult(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1 });
    const operation = store.getByJobId("job-one")!;
    store.compareAndSwap("job-one", operation.revision, { ...operation, maintenance: [...operation.maintenance, {
      maintenanceId: "unpublish:2", operation: "unpublish", state: "PLANNED",
      idempotencyKey: "official_v2_planned_fixture", exactJson: '{"rowVersion":2}',
      bodySha256: createHash("sha256").update('{"rowVersion":2}').digest("hex"), sourceRowVersion: 2
    }] });
    vi.mocked(api.request).mockClear(); vi.mocked(api.getContent).mockClear(); vi.mocked(api.getJob).mockClear();
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "delete" }))
      .resolves.toMatchObject({ status: "needs_reconciliation" });
    await expect(durable.recoverOriginalOperation(context(), "job-one"))
      .resolves.toMatchObject({ status: "needs_reconciliation" });
    expect(api.request).not.toHaveBeenCalled(); expect(api.getContent).not.toHaveBeenCalled(); expect(api.getJob).not.toHaveBeenCalled();
  });

  it("blocks every new maintenance action behind an uncertain maintenance request with no remote job", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozenArticle = durable.getPreparedArticleInput(context());
    await durable.finalSubmit(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: vi.fn() });
    await durable.collectPublishResult(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1 });
    const published = { ...remoteRecord(store.getByJobId("job-one")!.prepared.draftPreview, 2),
      externalId: store.getByJobId("job-one")!.externalId, publishedRevisionId: "20000000-0000-4000-a000-000000000001" };
    api.getContent = vi.fn(async () => ({ ok: true as const, requestId: "request-content", httpStatus: 200, data: published }));
    const normalRequest = api.request;
    api.request = vi.fn(async (method, path, options) => path.endsWith("/unpublish")
      ? Promise.reject(new ClientError("TRANSPORT_UNCERTAIN", "unknown", 0, undefined, undefined, options.idempotencyKey, true))
      : normalRequest(method, path, options)) as OfficialApiRuntimeClient["request"];
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "unpublish" }))
      .rejects.toMatchObject({ code: "TRANSPORT_UNCERTAIN" });
    vi.mocked(api.getJob).mockClear();
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "delete" }))
      .resolves.toMatchObject({ status: "needs_reconciliation" });
    await expect(durable.recoverOriginalOperation(context(), "job-one"))
      .resolves.toMatchObject({ status: "needs_reconciliation" });
    expect(vi.mocked(api.request).mock.calls.filter(([, path]) => path.endsWith("/delete"))).toHaveLength(0);
    expect(api.getJob).not.toHaveBeenCalled();
  });

  it("requires Main-bound acceptance authorization and a succeeded original publish before purging owned deleted content", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozenArticle = durable.getPreparedArticleInput(context());
    await durable.finalSubmit(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: vi.fn() });
    await durable.collectPublishResult(context(), frozenArticle, { jobId: "job-one", submissionIntentId: "intent", attempt: 1 });
    const deleted = { ...remoteRecord(store.getByJobId("job-one")!.prepared.draftPreview, 4),
      externalId: store.getByJobId("job-one")!.externalId, deletedAt: new Date(2).toISOString() };
    api.getContent = vi.fn(async () => ({ ok: true as const, requestId: "request-content", httpStatus: 200, data: deleted }));
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "purge" }))
      .rejects.toThrow("PURGE_MAIN_AUTHORIZATION_REQUIRED");
    expect(vi.mocked(api.request).mock.calls.some(([, path]) => path.endsWith("/purge"))).toBe(false);
    const normalRequest = api.request;
    api.request = vi.fn(async (method, path, options) => path.endsWith("/purge")
      ? { ok: true as const, requestId: "request-purge", httpStatus: 202, data: {
          ...(await client().getJob("ignored")).data, jobId: "60000000-0000-4000-a000-000000000001", operation: "purge",
          contentId: deleted.id, revisionId: deleted.revisionId, contentHash: deleted.contentHash, status: "queued", publicUrl: null } as never }
      : normalRequest(method, path, options)) as OfficialApiRuntimeClient["request"];
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "purge",
      mainAuthorization: { acceptanceRunId: "run-one", explicitPermission: true } }))
      .resolves.toMatchObject({ status: "publishing" });
    const purgeGetJob: OfficialApiRuntimeClient["getJob"] = async jobId => ({ ok: true, requestId: "request-job", httpStatus: 200, data: {
      ...(await client().getJob(jobId)).data, jobId, operation: "purge", contentId: deleted.id,
      status: "succeeded", publicUrl: null } });
    api.getJob = vi.fn(purgeGetJob);
    api.getContent = vi.fn(async () => { throw new ClientError("NOT_FOUND", "gone", 404, "request-content"); });
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "purge",
      mainAuthorization: { acceptanceRunId: "run-one", explicitPermission: true } }))
      .resolves.toMatchObject({ status: "maintained", operation: { maintenance: [{ operation: "purge",
        remoteJob: { status: "succeeded" } }] } });
    expect(vi.mocked(api.request).mock.calls.filter(([, path]) => path.endsWith("/purge"))).toHaveLength(1);
    vi.mocked(api.getJob).mockClear(); vi.mocked(api.getContent).mockClear();
    await expect(durable.recoverOriginalOperation(context(), "job-one")).resolves.toMatchObject({ status: "maintained" });
    expect(api.getJob).not.toHaveBeenCalled(); expect(api.getContent).not.toHaveBeenCalled();
  });

  it("serializes mutating work per job before any remote dispatch", async () => {
    const store = new MemoryStore(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const api = client({ uploadMedia: vi.fn(async () => { await gate; return (await client().uploadMedia(bytes, image.mimeType, "key")); }) });
    const durable = runtime(store, api); const first = durable.prepare(context(), prepared(), "job-one");
    await vi.waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(1));
    await expect(durable.prepare(context(), prepared(), "job-one")).rejects.toThrow("OPERATION_BUSY");
    release(); await first;
  });

  it("reruns signed writable scope/content/private-media preflight before the atomic final claim", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozen = durable.getPreparedArticleInput(context());
    api.capabilities = vi.fn(async () => ({ ok: true as const, requestId: "request-capabilities", httpStatus: 200,
      data: { siteId: "kangyi", environment: "staging", protocolVersion: "2", contentKinds: ["article", "case"] as const,
        writesEnabled: false, limits: { jsonBytes: 1_048_576, mediaBytes: 8_388_608, imagePixels: 40_000_000, imageDimension: 10_000 } } as Capabilities }));
    const claim = vi.fn();
    await expect(durable.finalSubmit(context(), frozen, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: claim })).rejects.toThrow("WRITES_DISABLED");
    expect(claim).not.toHaveBeenCalled();
    expect(vi.mocked(api.request).mock.calls.some(([, path]) => path.endsWith("/publish"))).toBe(false);
  });

  it("refuses a final submit without the durable SubmissionIntent claim before changing publish state", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozen = durable.getPreparedArticleInput(context());
    await expect(durable.finalSubmit(context(), frozen, { jobId: "job-one", submissionIntentId: "intent", attempt: 1 }))
      .rejects.toThrow("FINAL_SUBMIT_CLAIM_REQUIRED");
    expect(store.getByJobId("job-one")).toMatchObject({ phase: "PREPARED" });
    expect(store.getByJobId("job-one")?.publish).toBeUndefined();
    expect(vi.mocked(api.request).mock.calls.some(([, path]) => path.endsWith("/publish"))).toBe(false);
  });

  it("keeps a throwing SubmissionIntent claim uncertain and never sends the publish HTTP", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozen = durable.getPreparedArticleInput(context());
    await expect(durable.finalSubmit(context(), frozen, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: () => { throw new Error("CLAIM_WRITE_UNKNOWN"); } })).rejects.toThrow("CLAIM_WRITE_UNKNOWN");
    expect(store.getByJobId("job-one")).toMatchObject({ phase: "NEEDS_RECONCILIATION", publish: { state: "OUTCOME_UNKNOWN" } });
    expect(vi.mocked(api.request).mock.calls.some(([, path]) => path.endsWith("/publish"))).toBe(false);
  });

  it("reconciles an uncertain original publish before allowing any maintenance action", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozen = durable.getPreparedArticleInput(context());
    await expect(durable.finalSubmit(context(), frozen, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: () => { throw new Error("CLAIM_WRITE_UNKNOWN"); } })).rejects.toThrow("CLAIM_WRITE_UNKNOWN");
    await expect(durable.maintainOwnContent(context(), { jobId: "job-one", operation: "delete" }))
      .resolves.toMatchObject({ status: expect.stringMatching(/publishing|published|needs_reconciliation/u) });
    expect(vi.mocked(api.request).mock.calls.filter(([, path]) => path.endsWith("/delete"))).toHaveLength(0);
  });

  it("rejects a succeeded job URL for another slug and does not demote API success because fidelity is separate", async () => {
    const store = new MemoryStore(); const api = client(); const durable = runtime(store, api);
    await durable.prepare(context(), prepared(), "job-one"); const frozen = durable.getPreparedArticleInput(context());
    await durable.finalSubmit(context(), frozen, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: vi.fn() });
    api.getJob = vi.fn(async () => ({ ...(await client().getJob("40000000-0000-4000-a000-000000000001")),
      data: { ...(await client().getJob("40000000-0000-4000-a000-000000000001")).data,
        publicUrl: "https://staging.kangyihb.com/news/another-slug" } }));
    await expect(durable.collectPublishResult(context(), frozen, { jobId: "job-one", submissionIntentId: "intent", attempt: 1 }))
      .rejects.toThrow("PUBLIC_URL_UNTRUSTED");
  });

  it("getPublishStatus reads only the original journal/job and runs public fidelity once", async () => {
    const store = new MemoryStore(); const api = client(); const verifier = vi.fn(async () => ({ ok: true, evidence: { exact: true } }));
    const durable = new OfficialApiDurableRuntime({ operationStore: store, clientFactory: () => api,
      readMediaBytes: async () => bytes, formalExecution: { available: true }, publicVerifier: verifier });
    await durable.prepare(context(), prepared(), "job-one"); const frozen = durable.getPreparedArticleInput(context());
    await durable.finalSubmit(context(), frozen, { jobId: "job-one", submissionIntentId: "intent", attempt: 1,
      markSubmissionSideEffect: vi.fn() });
    const contentId = store.getByJobId("job-one")!.remoteContent!.contentId;
    await expect(durable.getPublishStatus(context(), contentId)).resolves.toMatchObject({ status: "published", externalId: contentId,
      response: { remoteJobId: "40000000-0000-4000-a000-000000000001", publicFidelity: "PASS" } });
    await durable.getPublishStatus(context(), contentId);
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.request).mock.calls.filter(([, path]) => path.endsWith("/publish"))).toHaveLength(1);
    await expect(durable.getPublishStatus(context(), "another-content")).rejects.toThrow("CONTENT_ID_MISMATCH");
  });
});
