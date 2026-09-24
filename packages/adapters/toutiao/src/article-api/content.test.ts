import { describe, expect, it } from "vitest";
import { normalizeToutiaoArticleContent, replaceImageSources } from "./content";

describe("Toutiao article HTML preparation", () => {
  const scan = (html: string) => normalizeToutiaoArticleContent(html, { platformHostedDomains: ["p3.toutiaoimg.com"] });

  it("discovers one or many images with quoted attributes and duplicate references", () => {
    const result = scan('<p>正文<img alt="x > y" src="https://other.example/a.jpg"><IMG SRC="https://other.example/a.jpg"><img src=asset://image-b><img src="//other.example/image.png"></p>');
    expect(result.imageReferences.map((image) => image.classification)).toEqual(["REMOTE_EXTERNAL", "REMOTE_EXTERNAL", "LOCAL_ASSET", "REMOTE_EXTERNAL"]);
    expect(result.imageReferences[0]?.source).toBe(result.imageReferences[1]?.source);
    expect(result.plainText).toBe("正文");
  });

  it("classifies platform hosted, file, missing, unsupported and invalid sources", () => {
    const result = scan('<img src="https://p3.toutiaoimg.com/a"><img src="file:///C:/image.png"><img><img src="data:image/png;base64,abc"><img src="blob:opaque"><img src="http://">');
    expect(result.imageReferences.map((image) => image.classification)).toEqual(["PLATFORM_HOSTED", "LOCAL_ASSET", "MISSING", "UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED"]);
    expect(result.diagnostics.map((item) => item.code)).toContain("UNSUPPORTED_IMAGE_SOURCE");
  });

  it("ignores fake img text in comments and scripts, and replaces exact src occurrences", () => {
    const html = '<!-- <img src="fake"> --><script>"<img src=\'fake\'>"</script><img src="asset://same"><img src="asset://same">';
    const result = scan(html);
    expect(result.imageReferences).toHaveLength(2);
    expect(replaceImageSources(result.normalizedHtml, result.imageReferences, new Map([["asset://same", "asset://sha256/hash"]]))).toContain('<img src="asset://sha256/hash"><img src="asset://sha256/hash">');
  });
});
