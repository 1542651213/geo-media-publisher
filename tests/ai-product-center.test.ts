import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import type { CredentialStore } from "@publisher/security";
import { AIProductCenter } from "../apps/desktop/src/main/ai-product-center";

it("keeps secrets out of metadata, repairs only title once, and saves drafts without jobs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-product-center-"));
  const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages/db/migrations"));
  const values = new Map<string, string>();
  const secrets: CredentialStore = { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); }, has: key => values.has(key) };
  try {
    const brand = repository.createBrand({ name: "甲品牌", companyName: "甲企业" });
    let calls = 0;
    const transport: typeof fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { title: "甲".repeat(21), body: "甲企业的流程说明" } : { title: "流程说明", body: "不得覆盖原正文" }) } }] })); };
    const Service = AIProductCenter as unknown as new (repo: typeof repository, store: CredentialStore, port: typeof fetch) => {
      saveProfile(input: unknown): { id: string }; setCredential(id: string, secret: string): void; profiles(): unknown;
      generate(input: unknown): Promise<Array<{ generationId: string; title: string; body: string }>>;
      saveDraft(id: string, title: string, body: string): { articleId: string };
    };
    const service = new Service(repository, secrets, transport);
    expect(service.saveProfile, "Main service profile boundary exists").toBeTypeOf("function");
    const profile = service.saveProfile({ provider: "mimo", displayName: "测试", baseUrl: "https://api.xiaomimimo.com/v1", defaultModel: "fixture-model", isDefault: true });
    service.setCredential(profile.id, "fixture-only-secret");
    expect(JSON.stringify(service.profiles())).not.toContain("fixture-only-secret");
    const drafts = await service.generate({ companyId: brand.id, sourceArticleId: null, sourceText: "甲企业流程", purpose: "平台适配", targetPlatforms: ["douyin"], profileId: profile.id, model: "fixture-model", templateId: "douyin", templateVersion: 1 });
    expect(calls).toBe(2);
    expect(drafts[0]).toMatchObject({ title: "流程说明", body: "甲企业的流程说明" });
    const saved = service.saveDraft(drafts[0]!.generationId, drafts[0]!.title, drafts[0]!.body);
    expect(repository.getArticle(saved.articleId)?.body).toBe("甲企业的流程说明");
    expect(repository.listJobs()).toEqual([]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
