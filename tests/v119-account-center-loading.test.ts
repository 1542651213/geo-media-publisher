import { describe, expect, it } from "vitest";
import type { AccountManagementRow } from "../apps/desktop/src/shared/api";
import type { Platform } from "@publisher/domain";
import { loadAccountCenterData } from "../apps/desktop/src/renderer/v11-ui-model";

describe("account center loading", () => {
  it("keeps the platform catalog when the account overview request fails", async () => {
    const platforms = [{ platformKey: "zhihu", displayName: "知乎" }] as Platform[];

    const result = await loadAccountCenterData({
      overview: async (): Promise<AccountManagementRow[]> => { throw new Error("overview unavailable"); },
      platforms: async (): Promise<Platform[]> => platforms,
      settings: async (): Promise<Record<string, unknown>> => ({ favoritePlatformKeys: "zhihu" })
    });

    expect(result.platforms).toEqual(platforms);
    expect(result.overview).toEqual([]);
    expect(result.favoritePlatformKeys).toEqual(["zhihu"]);
    expect(result.errors).toEqual(["overview"]);
  });
});
