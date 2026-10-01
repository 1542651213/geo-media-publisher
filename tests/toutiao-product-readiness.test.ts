import { describe, expect, it, vi } from "vitest";
import { assertToutiaoProductReadiness } from "../apps/desktop/src/main/toutiao-product-readiness";
import type { ValidationResult } from "@publisher/domain";
import type { ToutiaoAccountPreflightResult } from "../packages/adapters/toutiao/src/browser";
const fixture = () => ({ expectedCreatorId: "123", input: { articleId: "article", title: "真实服务沟通要点", body: "正文", summary: "导语", tags: [], images: ["owned.png"] },
  imageAvailable: true, imageBrandMatch: true, validate: vi.fn(async (): Promise<ValidationResult> => ({ valid: true, errors: [], warnings: [] })),
  inspect: vi.fn(async (): Promise<ToutiaoAccountPreflightResult> => ({ allowed: true, pageUrl: "https://mp.toutiao.com/", creatorCenterAccessible: true,
    articlePublishPermission: true, warnings: [], identity: { externalAccountId: "123", profileUrl: null, displayName: "运营账号" },
    identityCandidates: [], reasonCode: null, reason: null })) });
describe("Toutiao Main checks before creating the unique product job", () => {
  it("rejects content/image failures before browser inspection", async () => {
    const p = fixture(); p.validate.mockResolvedValue({ valid: false, errors: ["标题超过平台限制"], warnings: [] });
    await expect(assertToutiaoProductReadiness(p)).rejects.toThrow("标题超过平台限制"); expect(p.inspect).not.toHaveBeenCalled();
    for (const override of [{ imageAvailable: false }, { imageBrandMatch: false }])
      await expect(assertToutiaoProductReadiness({ ...fixture(), ...override })).rejects.toThrow("TOUTIAO_OWNED_IMAGE_REQUIRED");
  });
  it("requires current remote identity and article publishing permission", async () => {
    const p = fixture(); await expect(assertToutiaoProductReadiness(p)).resolves.toBeUndefined();
    p.inspect.mockResolvedValue({ ...(await p.inspect()), identity: { externalAccountId: "other", profileUrl: null, displayName: null } });
    await expect(assertToutiaoProductReadiness(p)).rejects.toThrow("TOUTIAO_ACCOUNT_IDENTITY_UNVERIFIED");
    await expect(assertToutiaoProductReadiness({ ...fixture(), expectedCreatorId: null })).rejects.toThrow();
  });
});
