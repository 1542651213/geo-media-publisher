import { expect, it } from "vitest";
import * as policy from "../apps/desktop/src/shared/product-platform-policy";
type Result = { allowed: boolean; blockers: string[]; authority: string };
const preflight = () => {
  const fn = (policy as unknown as { evaluateProductPreflight(input: unknown): Result }).evaluateProductPreflight;
  expect(fn, "Main product preflight exists").toBeTypeOf("function"); return fn;
};
const base = { platformKey: "douyin", companyId: "a", companyName: "甲企业", article: { id: "article", brandId: "a", title: "流程说明", body: "有正文" }, account: { id: "account", platformKey: "douyin", enabled: true, archivedAt: null }, identityVerified: true, images: [{ brandId: "a", available: true }], contentType: "article", publishMode: "CONFIRM_BEFORE_PUBLISH" };
it("blocks a title beyond 20 UTF-16 units before Job creation", () => { expect(preflight()({ ...base, article: { ...base.article, title: "😀".repeat(11) } })).toMatchObject({ allowed: false, authority: "Main" }); });
it("does not accept local logged_in as remote identity or bypass ordinary OFF", () => {
  expect(preflight()({ ...base, identityVerified: false })).toMatchObject({ allowed: false });
  expect(preflight()({ ...base, platformKey: "weibo", account: { ...base.account, platformKey: "weibo" } })).toMatchObject({ allowed: false });
});
it("allows the accepted single-image exact-account route when Main identity is verified", () => { expect(preflight()(base)).toMatchObject({ allowed: true }); });
