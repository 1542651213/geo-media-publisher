import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { inspectAcrCrawlerRuntime, safeCdpFunctionLocation } from "./protocol-acrawler-runtime";

describe("Toutiao acrawler runtime diagnostics", () => {
  it("maps a CDP function location to a script path without query values", () => {
    const scripts = new Map([["17", "https://sf1-cdn-tos.toutiaostatic.com/obj/rc-web-sdk/acrawler.js?token=secret"]]);
    const location = safeCdpFunctionLocation({ internalProperties: [{ name: "[[FunctionLocation]]",
      value: { value: { scriptId: "17", lineNumber: 2, columnNumber: 31 } } }] }, scripts);
    expect(location).toEqual({ host: "sf1-cdn-tos.toutiaostatic.com", path: "/obj/rc-web-sdk/acrawler.js",
      lineNumber: 2, columnNumber: 31 });
    expect(JSON.stringify(location)).not.toContain("secret");
  });

  it("rejects missing, malformed, and unsafe script locations", () => {
    const scripts = new Map([["18", "http://unsafe.example/sign.js?credential=secret"]]);
    expect(safeCdpFunctionLocation({}, scripts)).toBeNull();
    expect(safeCdpFunctionLocation({ internalProperties: [{ name: "[[FunctionLocation]]",
      value: { value: { scriptId: "18", lineNumber: 0, columnNumber: 1 } } }] }, scripts)).toBeNull();
    expect(safeCdpFunctionLocation({ internalProperties: [{ name: "[[FunctionLocation]]",
      value: { value: { scriptId: "18", lineNumber: -1, columnNumber: 1 } } }] }, scripts)).toBeNull();
  });

  it("collects hashes and locations without invoking SDK exports or exposing a script query", async () => {
    let invoked = 0;
    const sdk = { init() { invoked++; return "secret-init"; }, sign() { invoked++; return "secret-signature"; } };
    vi.stubGlobal("window", { byted_acrawler: sdk });
    let scriptParsed: ((event: unknown) => void) | undefined;
    const session = {
      on: vi.fn((_event: string, callback: (event: unknown) => void) => { scriptParsed = callback; }),
      send: vi.fn(async (method: string) => {
        if (method === "Debugger.enable") scriptParsed?.({ scriptId: "17",
          url: "https://sf1-cdn-tos.toutiaostatic.com/obj/rc-web-sdk/acrawler.js?cookie=secret" });
        if (method === "Runtime.evaluate") return { result: { objectId: "function-17" } };
        if (method === "Runtime.getProperties") return { internalProperties: [{ name: "[[FunctionLocation]]",
          value: { value: { scriptId: "17", lineNumber: 0, columnNumber: 5 } } }] };
        return {};
      }),
      detach: vi.fn(async () => undefined)
    };
    const page = { evaluate: vi.fn(async (callback: () => Promise<unknown>) => callback()),
      context: () => ({ newCDPSession: async () => session }) } as unknown as Page;
    try {
      const result = await inspectAcrCrawlerRuntime(page);
      expect(result.objectFound).toBe(true);
      expect(result.initSignSameObject).toBe(false);
      expect(result.locationStatus).toBe("CAPTURED");
      expect(result.functions.find((item) => item.name === "sign")?.location?.path).toBe("/obj/rc-web-sdk/acrawler.js");
      expect(result.functions.find((item) => item.name === "sign")?.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(invoked).toBe(0);
      expect(JSON.stringify(result)).not.toContain("secret");
    } finally { vi.unstubAllGlobals(); }
  });
});
