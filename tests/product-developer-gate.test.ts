import { expect, it } from "vitest";
import * as gate from "../apps/desktop/src/main/operator-publish-gate";
it("requires Developer mode for diagnostic writes and keeps ordinary OFF after it is enabled", () => {
  const check = (gate as unknown as { assertProductDeveloperOperation(channel: string, enabled: boolean, platformKey?: string): void }).assertProductDeveloperOperation;
  expect(check, "Main diagnostic gate exists").toBeTypeOf("function");
  expect(() => check("platform-self-test:confirm-publish", false, "weibo")).toThrow();
  expect(() => check("platform-self-test:confirm-publish", true, "weibo")).toThrow("尚未");
  expect(() => check("toutiao:publish-request-capture", false)).toThrow("Developer");
  expect(() => check("accounts:check-login", false)).not.toThrow();
  expect(() => check("platform-self-test:run-level", true, "weibo")).toThrow("尚未");
  expect(() => check("platform-self-test:continue", true, "sohu_media")).toThrow("尚未");
  for (const level of ["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT"]) {
    expect(() => gate.assertProductDeveloperOperation("platform-self-test:run-level", true, "weibo", level)).not.toThrow();
  }
  expect(() => gate.assertProductDeveloperOperation("platform-self-test:run-level", true, "weibo", "L5_PUBLISH")).toThrow("尚未");
});
