import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { AIProductCenter } from "../apps/desktop/src/main/ai-product-center";
import type { CredentialStore } from "@publisher/security";

it("binds approved company facts to mandatory context and immutable generation inputs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "facts-ai-f-"));
  const { db, repository } = openDatabase(join(dir, "db"), join(process.cwd(), "packages/db/migrations"));
  const keys = new Map<string, string>();
  const credentials: CredentialStore = { has: key => keys.has(key), get: key => keys.get(key) ?? null, set: (key, value) => { keys.set(key, value); }, delete: key => { keys.delete(key); } };
  try {
    const company = repository.createBrand({ name: "甲品牌", companyName: "甲企业" });
    const service = new AIProductCenter(repository, credentials, async (_url, options) => {
      const payload = JSON.parse(String(options?.body)) as { messages: Array<{ content: string }> };
      expect(payload.messages[0]!.content).toContain("已确认提供流程咨询");
      expect(payload.messages[0]!.content).not.toContain("虚构资质");
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "流程说明", body: "甲企业提供流程咨询" }) } }] }));
    }, id => id === company.id ? ["已确认提供流程咨询"] : []);
    const profile = service.saveProfile({ provider: "custom", displayName: "本地", baseUrl: "http://127.0.0.1:8888/v1", defaultModel: "fixture", isDefault: true });
    service.setCredential(profile.id, "non-production-fixture");
    const result = await service.generate({ companyId: company.id, sourceArticleId: null, sourceText: "流程咨询资料", purpose: "生成文章", targetPlatforms: ["weibo"], profileId: profile.id, model: "fixture", templateId: "industry", templateVersion: 1 });
    expect(result[0]?.status).toBe("Generated");
    expect(service.store.inputs(result[0]!.generationId)?.context.approvedClaims).toContain("已确认提供流程咨询");
    expect(repository.listJobs()).toEqual([]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
