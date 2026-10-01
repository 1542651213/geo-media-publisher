import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import type { CredentialStore } from "@publisher/security";
import { AIProductCenter } from "../apps/desktop/src/main/ai-product-center";

async function fixture(run: (service: AIProductCenter, repository: ReturnType<typeof openDatabase>["repository"], profileId: string) => Promise<void>, transport: typeof fetch): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "ai-product-recovery-"));
  const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages/db/migrations"));
  const values = new Map<string, string>();
  const store: CredentialStore = { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); }, has: key => values.has(key) };
  try {
    const service = new AIProductCenter(repository, store, transport);
    const profile = service.saveProfile({ provider: "custom", displayName: "本地验收", baseUrl: "http://127.0.0.1:19081/v1", defaultModel: "fixture-model", isDefault: true });
    service.setCredential(profile.id, "non-production-fixture");
    await run(service, repository, profile.id);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}
const completion = (title: string, body = "甲企业流程资料") => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title, body }) } }] }));
const request = (companyId: string, profileId: string) => ({ companyId, sourceArticleId: null, sourceText: "甲企业流程资料", purpose: "平台适配", targetPlatforms: ["douyin"], profileId, model: "fixture-model", templateId: "industry", templateVersion: 1 });

it("retains the first draft when its one title repair has an unknown result", async () => {
  let calls = 0;
  await fixture(async (service, repository, profileId) => {
    const brand = repository.createBrand({ name: "甲品牌", companyName: "甲企业" });
    const [draft] = await service.generate(request(brand.id, profileId));
    expect(calls).toBe(2);
    expect(draft).toMatchObject({ title: "甲".repeat(21), body: "甲企业流程资料", status: "NeedsUserAction" });
    expect(service.draft(draft!.generationId)?.body).toBe("甲企业流程资料");
    expect(() => service.saveDraft(draft!.generationId, draft!.title, draft!.body)).toThrow("校验");
    expect(repository.listJobs()).toEqual([]);
  }, async () => { calls++; if (calls === 2) throw new Error("request outcome unknown"); return completion("甲".repeat(21)); });
});

it("validates and saves a draft after it leaves the recent 200 history window", async () => {
  await fixture(async (service, repository, profileId) => {
    const brand = repository.createBrand({ name: "甲品牌", companyName: "甲企业" });
    const [draft] = await service.generate(request(brand.id, profileId));
    const old = service.history()[0]!;
    for (let i = 0; i < 201; i++) service.store.start({ ...old, generationId: `later-${i}`, createdAt: "2099-01-01T00:00:00.000Z", status: "Running" });
    expect(service.history()).toHaveLength(200);
    expect(service.validateDraft(draft!.generationId, draft!.title, draft!.body).errors).toEqual([]);
    expect(service.saveDraft(draft!.generationId, draft!.title, draft!.body).articleId).toBeTruthy();
  }, async () => completion("流程说明"));
});

it("creates six local variants, preserves the source and refuses a cross-company source", async () => {
  await fixture(async (service, repository, profileId) => {
    const brand = repository.createBrand({ name: "甲品牌", companyName: "甲企业" });
    const other = repository.createBrand({ name: "乙品牌", companyName: "乙企业" });
    const source = repository.createArticle({ brandId: brand.id, title: "源稿", body: "源正文", topic: "资料", keyword: "", city: "", summary: "", tags: [], seoKeywords: [], articleType: "article", aiProvider: "manual", aiModel: "manual", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "source", source: "production" })!;
    await expect(service.generate({ ...request(other.id, profileId), sourceArticleId: source.id })).rejects.toThrow("不匹配");
    const outputs = await service.generate({ ...request(brand.id, profileId), sourceArticleId: source.id, targetPlatforms: ["douyin", "toutiao", "weibo", "sohu_media", "website", "cnblogs"] });
    expect(outputs).toHaveLength(6);
    for (const draft of outputs) {
      const saved = service.saveDraft(draft.generationId, draft.title, draft.body);
      expect(saved.articleId).not.toBe(source.id);
      expect(repository.getArticle(saved.articleId)).toMatchObject({ body: draft.body, source: "content_studio", targetPlatforms: [draft.platformKey] });
      expect(saved.variantId).toBeTruthy();
      expect(service.saveDraft(draft.generationId, draft.title, draft.body)).toEqual(saved);
    }
    expect(repository.getArticle(source.id)?.body).toBe("源正文");
    expect(repository.listJobs()).toEqual([]);
    expect(repository.getPublishRecords()).toEqual([]);
  }, async () => completion("流程说明"));
});
it("requires credential re-entry after a Custom endpoint changes", async () => {
  await fixture(async (service, _repository, profileId) => {
    expect(service.profiles().find(item => item.id === profileId)?.configured).toBe(true);
    service.saveProfile({ id: profileId, provider: "custom", displayName: "更换服务", baseUrl: "https://example.invalid/v1", defaultModel: "fixture-model", isDefault: true });
    expect(service.profiles().find(item => item.id === profileId)?.configured).toBe(false);
  }, async () => completion("标题"));
});
it("seals Product refs and defaults against legacy renderer profile writes", async () => {
  await fixture(async (service, repository, profileId) => {
    const oldDefault = repository.upsertAiProviderProfile({ name: "历史默认", provider: "mock", baseUrl: "https://example.invalid/v1", model: "mock", credentialRef: "ai:apiKey", temperature: 0.7, maxOutputTokens: 3000, timeoutMs: 30000, retryCount: 0, concurrency: 1, enabled: true, isDefault: true, isFallback: false });
    const metadata = service.profiles()[0]!;
    expect(metadata).not.toHaveProperty("credentialRef");
    const unsafeLegacy = repository.upsertAiProviderProfile({ ...oldDefault, id: undefined, provider: "custom", name: "旧兼容配置", baseUrl: "https://legacy.example.invalid/v1" });
    expect(service.legacyProfileConfigured(unsafeLegacy.id)).toBe(false);
    const { createdAt: _oldCreated, updatedAt: _oldUpdated, ...unsafeInput } = unsafeLegacy;
    expect(service.saveLegacyProfile(unsafeInput).credentialRef).toBe(`ai:legacy:${unsafeLegacy.id}`);
    const params = { ...oldDefault, id: undefined, name: "任意兼容端点", provider: "custom", baseUrl: "https://example.invalid/v1", credentialRef: `ai:provider:${profileId}` };
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...input } = params;
    const legacy = service.saveLegacyProfile(input);
    expect(legacy.credentialRef).toBe(`ai:legacy:${legacy.id}`);
    expect(() => service.saveLegacyProfile({ ...input, id: profileId })).toThrow("Provider Center");
    expect(() => service.deleteLegacyProfile(profileId)).toThrow("历史入口");
    service.setLegacyCredential(legacy.id, "isolated-legacy-fixture");
    expect(service.legacyProfileConfigured(legacy.id)).toBe(true);
    service.saveLegacyProfile({ ...input, id: legacy.id, baseUrl: "https://changed.example.invalid/v1" });
    expect(service.legacyProfileConfigured(legacy.id)).toBe(false);
    service.saveProfile({ id: profileId, provider: "custom", displayName: "本地验收", baseUrl: "http://127.0.0.1:19081/v1", defaultModel: "fixture-model", isDefault: true });
    expect(repository.getAiProviderProfile(oldDefault.id)?.isDefault).toBe(true);
    expect(service.profiles()).toHaveLength(1);
  }, async () => completion("标题"));
});
it("retains immutable company/source inputs and recovers interrupted requests without replay", async () => {
  await fixture(async (service, repository, profileId) => {
    const brand = repository.createBrand({ name: "甲品牌", companyName: "甲企业" });
    service.saveContext({ ...service.context(brand.id), approvedClaims: ["已确认资料"] });
    const [draft] = await service.generate(request(brand.id, profileId));
    const inputs = service.store.inputs(draft!.generationId)!;
    expect(inputs).toMatchObject({ contextVersion: 1, sourceText: "甲企业流程资料", purpose: "平台适配", profileId });
    service.saveContext({ ...service.context(brand.id), approvedClaims: ["后来的资料"] });
    expect(service.store.inputs(draft!.generationId)?.context.approvedClaims).toEqual(["已确认资料"]);
    expect(inputs.contextHash).toHaveLength(64);
    expect(inputs.sourceHash).toHaveLength(64);
    const pending = { ...service.history()[0]!, generationId: "interrupted", status: "Running" as const };
    service.store.start(pending);
    expect(service.store.recoverInterrupted()).toBe(1);
    expect(service.store.generation(pending.generationId)?.status).toBe("Unknown");
    expect(repository.listJobs()).toEqual([]);
  }, async () => completion("流程说明"));
});
