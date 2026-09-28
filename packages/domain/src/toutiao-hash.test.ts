import { describe, expect, it } from "vitest";
import { hashToutiaoContentBinding, sha256Canonical } from "./toutiao-hash";

describe("Toutiao Node hash boundary", () => {
  it("preserves the canonical and semantic content hash fixtures", () => {
    expect(sha256Canonical({ z: 2, a: "例" })).toBe("ac0d2811f0e13f50fa856761d375dcddea11bd3037d1024532ddcbb0a6e68b45");
    expect(hashToutiaoContentBinding({
      accountId: "account-1", brandId: "brand-1", title: "示例 Title", normalizedHtml: "<p>正文</p>",
      coverMode: "none", coverUploadKeys: [], bodyImageUploadKeys: [], articleAdType: "none",
      remoteScheduledAt: null, settingsSnapshotVersion: 1, assetSnapshots: []
    })).toBe("920ffae8ed9b6efb7f550ac23806029eff2dad92dd7e528bb4f749a25b29d084");
  });
});
