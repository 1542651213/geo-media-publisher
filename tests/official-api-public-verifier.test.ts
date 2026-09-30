import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyOfficialApiPublicContent } from "../apps/desktop/src/main/official-api-public-verifier";
const id = "10000000-0000-4000-a000-000000000001";
const input = { publicUrl: "https://staging.kangyihb.com/news/fixture", operation: { environment: "staging", prepared: { slug: "fixture", settings: { kind: "article" }, source: { title: "系统验收", body: "原文" }, draftPreview: { blocks: [{ type: "paragraph", text: "原文 & 内容" }] } }, media: [{ remote: { mediaId: id } }] } };
afterEach(() => vi.unstubAllGlobals());
describe("Website independent SSR fidelity", () => {
  it("requires images in visible raw markup and checks public media 200", async () => {
    const request = vi.fn(async (url: URL | string) => new Response(String(url).includes('/media/') ? "pixels" : `<h1>系统验收</h1><p>原文 &amp; 内容</p><img src="/media/${id}">`, { status: 200 }));vi.stubGlobal("fetch", request);
    const result = await verifyOfficialApiPublicContent(input);
    expect(result.ok).toBe(true);expect(result.evidence).toMatchObject({ rawSsr: true, mediaCount: 1, mediaHttp200: 1 });expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not count an image that appears only in hydration data", async () => {
    const request = vi.fn(async () => new Response(`<h1>系统验收</h1><p>原文 &amp; 内容</p><script>{"image":"/media/${id}"}</script>`, {status:200}));vi.stubGlobal("fetch", request);
    expect(await verifyOfficialApiPublicContent(input)).toMatchObject({ ok: false, warning: "PUBLIC_SSR_IMAGE_MISSING" });expect(request).toHaveBeenCalledTimes(1);
  });
  it("records a warning for unavailable public media without suggesting any publish", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL | string) => new Response(String(url).includes('/media/') ? "missing" : `<h1>系统验收</h1><p>原文 &amp; 内容</p><img src="/media/${id}">`, {status:String(url).includes('/media/')?404:200})));
    expect(await verifyOfficialApiPublicContent(input)).toMatchObject({ ok: false, warning: "PUBLIC_MEDIA_UNAVAILABLE" });
  });
  it("rejects a different origin or content path before transport", async () => {
    const request=vi.fn();vi.stubGlobal("fetch", request);
    for(const publicUrl of ["https://untrusted.example/news/fixture","https://staging.kangyihb.com/news/other"])
      expect(await verifyOfficialApiPublicContent({...input,publicUrl})).toMatchObject({ok:false,warning:"PUBLIC_URL_BINDING_MISMATCH"});
    expect(request).not.toHaveBeenCalled();
  });
});
