import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Platform } from "@publisher/domain";
import { addAccountConnectionMode, addAccountConnectionModes } from "../apps/desktop/src/main/account-connection";

function platform(overrides: Partial<Platform> = {}): Platform {
  return {
    id: "platform-1",
    platformKey: "toutiao",
    displayName: "Toutiao",
    category: "图文/视频",
    adapterStatus: "ready",
    adapterVersion: "1.0.0",
    enabled: true,
    capabilities: { article: true, imagePost: true, video: true, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10 },
    researchStatus: "partial",
    healthStatus: "healthy",
    lastVerifiedAt: "2026-08-21",
    verificationStatus: "WaitingForUser",
    backgroundAutomationStatus: "UNKNOWN",
    backgroundAutomationLastTestedAt: null,
    backgroundAutomationReason: null,
    transport: "official_api",
    integrationMode: "API",
    officialWebsite: "https://www.toutiao.com",
    developerPortal: "https://open.douyin.com",
    blockingReason: null,
    authStrategy: "OAuth2",
    callbackStrategy: "ManualCodeCallback",
    credentialSchema: [],
    officialSources: [],
    ...overrides
  };
}

describe("account connection platform views", () => {
  it("overlays the browser connection capability without changing Toutiao publish transport", () => {
    const registry = { getAccountConnectionMode: vi.fn(() => "BrowserAutomation") } as unknown as AdapterRegistry;
    const view = addAccountConnectionMode(platform(), registry);

    expect(view).toMatchObject({ transport: "official_api", integrationMode: "API", accountConnectionMode: "BrowserAutomation" });
    expect(registry.getAccountConnectionMode).toHaveBeenCalledWith("toutiao");
  });

  it("preserves platform metadata when no account connection adapter is registered", () => {
    const registry = { getAccountConnectionMode: vi.fn(() => null) } as unknown as AdapterRegistry;
    const original = platform({ platformKey: "douyin", integrationMode: "OAuth" });
    const view = addAccountConnectionMode(original, registry);

    expect(view).toEqual(original);
    expect(addAccountConnectionModes([original], registry)).toEqual([original]);
  });
});
