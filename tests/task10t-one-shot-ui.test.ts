import { describe, expect, it } from "vitest";
import { OneShotConfirmationUiGuard, oneShotConfirmationErrorMessage } from "../apps/desktop/src/renderer/one-shot-confirmation-ui";

describe("Task10T one-shot confirmation UI", () => {
  it("admits one confirmation click until the request settles", () => {
    const guard = new OneShotConfirmationUiGuard();

    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false);
    guard.release();
    expect(guard.tryAcquire()).toBe(true);
  });

  it("renders an authorization setup error without claiming publication started", () => {
    expect(oneShotConfirmationErrorMessage(new Error("no such table: one_shot_publication_authorizations"))).toBe("一次性发布授权创建失败，尚未进入发布流程。");
    expect(oneShotConfirmationErrorMessage(new Error("一次性发布授权创建失败，尚未进入发布流程。"))).toBe("一次性发布授权创建失败，尚未进入发布流程。");
  });
});
