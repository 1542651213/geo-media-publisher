import { describe, expect, it, vi } from "vitest";
import { inspectProtocolScript, inspectRuntimeSdkSurface, safeProtocolScriptPath } from "./protocol-script-discovery";

describe("Toutiao read-only script discovery", () => {
  it("returns bounded keyword offsets and a byte hash without script source or URL query values", () => {
    const source = new TextEncoder().encode('const a="a_bogus"; const b="msToken"; const c="/mp/agw/article/publish";');
    const result = inspectProtocolScript("https://mp.toutiao.com/static/app.123.js?token=secret", source);
    expect(result?.host).toBe("mp.toutiao.com");
    expect(result?.path).toBe("/static/app.123.js");
    expect(result?.byteLength).toBe(source.length);
    expect(result?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result?.keywordOffsets.a_bogus).toEqual([9]);
    expect(result?.keywordOffsets.msToken).toHaveLength(1);
    expect(result?.keywordOffsets["/mp/agw/article/publish"]).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/secret|const a=/u);
  });

  it("redacts unsafe path segments and rejects oversized or non-HTTPS scripts", () => {
    expect(safeProtocolScriptPath("https://mp.toutiao.com/a/verylongsecretstring12345678901234567890123456789012345678901234567890.js?q=secret")?.path).toContain("redactedSegment");
    expect(inspectProtocolScript("http://mp.toutiao.com/app.js", new Uint8Array())).toBeNull();
    expect(inspectProtocolScript("https://mp.toutiao.com/app.js", new Uint8Array(12_000_001))).toBeNull();
  });

  it("lists SDK own-property metadata without calling getters or exported functions", () => {
    let invoked = false;
    const sdk = { sign(_input: string) { invoked = true; return "secret"; }, get unsafe() { invoked = true; throw new Error("must not run"); } };
    vi.stubGlobal("window", { byted_acrawler: sdk });
    const result = inspectRuntimeSdkSurface("byted_acrawler");
    vi.unstubAllGlobals();
    expect(result?.members).toContainEqual({ name: "sign", kind: "function", arity: 1 });
    expect(result?.members).toContainEqual({ name: "unsafe", kind: "accessor", arity: null });
    expect(invoked).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("records only method names adjacent to a known SDK identifier", () => {
    const source = new TextEncoder().encode('window.byted_acrawler.sign(input); byted_acrawler["init"]();');
    const result = inspectProtocolScript("https://mp.toutiao.com/app.js", source);
    expect(result?.sdkMemberReferences).toEqual([{ sdk: "byted_acrawler", member: "sign", offset: 7 }, { sdk: "byted_acrawler", member: "init", offset: 35 }]);
    expect(JSON.stringify(result)).not.toContain("input");
  });
});
