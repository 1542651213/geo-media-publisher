import { describe, expect, it } from "vitest";
import { preparedPublishMessage } from "./publish-capability";

describe("prepare-publish final submit capability messaging", () => {
  it("does not downgrade an AUTO_PUBLISH response with verified final submit control", () => {
    expect(preparedPublishMessage("prepared", "AUTO_PUBLISH", {
      finalSubmitControl: { verified: true }
    })).toBe("prepared");
  });

  it("downgrades an AUTO_PUBLISH response without verified final submit control", () => {
    expect(preparedPublishMessage("prepared", "AUTO_PUBLISH", {
      finalSubmitControl: { verified: false }
    })).toContain("降级为发布前确认");
  });
});
