import { describe, expect, it } from "vitest";
import { classifyDouyinPublicContent } from "./image-text-browser";

describe("Douyin independent public content fidelity", () => {
  const article = { title: "室内空气管理", body: "第一段\n第二段\n第三段" };
  it("passes the complete original body and visible image", () => {
    expect(classifyDouyinPublicContent(article, { text: `${article.title}\n${article.body}`, imageCount: 1 }))
      .toMatchObject({ publicContentVerified: "PASS", bodyMatch: true, contentFidelityWarning: null });
  });
  it("reports literal stars as FAIL without normalizing or ignoring them", () => {
    expect(classifyDouyinPublicContent(article, { text: `${article.title}\n第一段*第二段*第三段`, imageCount: 1 }))
      .toMatchObject({ publicContentVerified: "FAIL", bodyMatch: false,
        contentFidelityWarning: "BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK" });
  });
  it("rejects incomplete body, wrong title and missing image independently", () => {
    for (const observation of [{ text: `${article.title}\n第一段`, imageCount: 1 },
      { text: article.body, imageCount: 1 }, { text: `${article.title}\n${article.body}`, imageCount: 0 }]) {
      expect(classifyDouyinPublicContent(article, observation).publicContentVerified).toBe("FAIL");
    }
  });
});
