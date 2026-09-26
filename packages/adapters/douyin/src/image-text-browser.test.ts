import { describe, expect, it } from "vitest";
import type { CredentialStore } from "@publisher/security";
import { DouyinImageTextBrowserAdapter, douyinRequiredSettingsPass, parseVisibleDouyinCreatorId } from "./image-text-browser";

const store: CredentialStore = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false };

describe("Douyin image/text BrowserNative adapter", () => {
  it("requires a visible stable Douyin ID rather than accepting the home URL alone", () => {
    expect(parseVisibleDouyinCreatorId("抖音号：72388977613")).toBe("72388977613");
    expect(parseVisibleDouyinCreatorId("欢迎来到创作者中心")).toBeNull();
    expect(parseVisibleDouyinCreatorId("抖音号：123 抖音号：456")).toBeNull();
  });

  it("fails closed unless public visibility and schedule-off are explicit", () => {
    const base = { visibility: "public" as const, visibilitySelected: true, timing: "immediate" as const,
      timingSelected: true, requiredEmptyCount: 0, unknownMandatoryCount: 0, selectedMandatory: [] };
    expect(douyinRequiredSettingsPass(base)).toBe(true);
    expect(douyinRequiredSettingsPass({ ...base, visibilitySelected: false })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, visibility: "private" })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, timing: "scheduled" })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, timingSelected: false })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, requiredEmptyCount: 1 })).toBe(false);
  });
  it("advertises an article-only, one-image route with default-off formal submit", async () => {
    const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store });
    expect(adapter.manifest.platformKey).toBe("douyin");
    expect(adapter.manifest.transport).toBe("browser");
    expect(adapter.manifest.supportsArticle).toBe(true);
    expect(adapter.manifest.supportsVideo).toBe(false);
    expect(adapter.getCapabilities()).toMatchObject({ article: true, imagePost: true, video: false, maxImageCount: 1,
      scheduledPublish: false, draft: false, contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER" });
    expect(() => adapter.assertFormalSubmitAvailable()).toThrow(/disabled/u);
    const base = { articleId: "article", title: "测试", body: "正文", summary: "", tags: [], images: ["test.png"] };
    await expect(adapter.validateArticle(base)).resolves.toMatchObject({ valid: true });
    await expect(adapter.validateArticle({ ...base, images: [] })).resolves.toMatchObject({ valid: false });
    await expect(adapter.validateArticle({ ...base, images: ["a.png", "b.png"] })).resolves.toMatchObject({ valid: false });
    await expect(adapter.validateArticle({ ...base, tags: ["话题"] })).resolves.toMatchObject({ valid: false });
  });
});
