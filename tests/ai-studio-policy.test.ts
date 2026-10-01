import { expect, it } from "vitest";
import * as domain from "@publisher/domain";

const validator = () => {
  const value = (domain as unknown as { validateStudioDraft: (input: unknown) => { errors: string[]; warnings: string[] } }).validateStudioDraft;
  expect(value, "deterministic draft validator exists").toBeTypeOf("function");
  return value;
};
const context = { companyId: "a", companyName: "甲企业", brandNames: ["甲品牌"], serviceAreas: [], coreServices: [], contactInfo: { phone: "13800138000" }, verifiedSellingPoints: [], approvedClaims: [], forbiddenClaims: ["包治百病"], seoKeywords: [], geoKeywords: [], tone: "专业", officialWebsite: "" };
it("rejects unsupported claims, wrong company, contact and UTF-16 title overflow", () => {
  const result = validator()({ context, platformKey: "douyin", title: "😀".repeat(11), body: "乙企业已获得国家认证，包治百病，电话13900139000", otherCompanies: ["乙企业"], otherBrands: [], recent: [] });
  expect(result.errors).toEqual(expect.arrayContaining(["TITLE_TOO_LONG", "COMPANY_MISMATCH", "CONTACT_MISMATCH", "FORBIDDEN_CLAIM", "UNAPPROVED_CLAIM"]));
});
it("warns about same-company exact duplicates without silently changing text", () => {
  const result = validator()({ context, platformKey: "weibo", title: "判断流程", body: "甲企业提供流程说明", otherCompanies: [], otherBrands: [], recent: [{ title: "判断流程", body: "甲企业提供流程说明" }] });
  expect(result.errors).toEqual([]);
  expect(result.warnings).toEqual(["DUPLICATE_TITLE", "DUPLICATE_BODY"]);
});
it("checks landlines, 400 numbers and official contact websites against the active enterprise", () => {
  const input = { context: { ...context, contactInfo: { phone: "025-12345678", service: "400-123-4567" }, officialWebsite: "https://example.invalid" }, platformKey: "website", title: "联系方式", otherCompanies: [], otherBrands: [], recent: [] };
  expect(validator()({ ...input, body: "02512345678，4001234567。官网：https://example.invalid" }).errors).toEqual([]);
  expect(validator()({ ...input, body: "联系电话010-87654321。官网：https://wrong.invalid" }).errors).toContain("CONTACT_MISMATCH");
});
it("requires provided evidence for concrete results and keeps forbidden claims blocked even in the source", () => {
  const input = { context, platformKey: "website", title: "流程", body: "处理30吨，效率提高50%，包治百病", otherCompanies: [], otherBrands: [], recent: [] };
  expect(validator()(input).errors).toContain("UNAPPROVED_CLAIM");
  const supported = validator()({ ...input, sourceFacts: input.body });
  expect(supported.errors).not.toContain("UNAPPROVED_CLAIM");
  expect(supported.errors).toContain("FORBIDDEN_CLAIM");
});
it("ships twelve immutable templates with distinct editorial purposes", () => {
  expect(domain.DEFAULT_PROMPT_TEMPLATES).toHaveLength(12);
  expect(new Set(domain.DEFAULT_PROMPT_TEMPLATES.map(item => item.systemPrompt)).size).toBe(12);
  expect(domain.DEFAULT_PROMPT_TEMPLATES.find(item => item.templateId === "website-case")?.contentType).toBe("case");
});
