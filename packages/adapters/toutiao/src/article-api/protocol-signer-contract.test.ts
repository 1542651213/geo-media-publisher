import { describe, expect, it, vi } from "vitest";
import { probeAcrCrawlerSignInPage } from "./protocol-signer-contract";

describe("guarded acrawler contract probe", () => {
  it("reports only metadata for zero and empty-object arguments", async () => {
    const sign = vi.fn((input?: unknown) => input === undefined ? "raw-signature-secret" : { a_bogus: "another-secret" });
    vi.stubGlobal("window", { byted_acrawler: { sign, init: () => undefined } });
    vi.stubGlobal("document", { documentElement: {}, defaultView: {} });
    vi.stubGlobal("MutationObserver", class { observe(): void {} disconnect(): void {} takeRecords(): [] { return []; } });
    vi.stubGlobal("localStorage", { length: 0, key: () => null, getItem: () => null });
    vi.stubGlobal("sessionStorage", { length: 0, key: () => null, getItem: () => null });
    try {
      const result = await probeAcrCrawlerSignInPage();
      expect(result.exists).toBe(true);
      expect(result.signExists).toBe(true);
      expect(result.probes.map((probe) => probe.inputShape)).toEqual(["NO_ARGUMENTS", "EMPTY_OBJECT"]);
      expect(result.probes[0]?.returnType).toBe("string");
      expect(result.probes[0]?.returnLength).toBe(20);
      expect(result.probes[1]?.returnKeys).toEqual(["a_bogus"]);
      expect(JSON.stringify(result)).not.toMatch(/raw-signature-secret|another-secret/u);
      expect(sign).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it("classifies thrown errors without exposing message text", async () => {
    vi.stubGlobal("window", { byted_acrawler: { sign: () => { throw new Error("url required; secret-value"); } } });
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("MutationObserver", class { observe(): void {} disconnect(): void {} takeRecords(): [] { return []; } });
    vi.stubGlobal("localStorage", { length: 0, key: () => null, getItem: () => null });
    vi.stubGlobal("sessionStorage", { length: 0, key: () => null, getItem: () => null });
    try {
      const result = await probeAcrCrawlerSignInPage();
      expect(result.probes.every((probe) => probe.exceptionCategory === "URL_ARGUMENT_REQUIRED")).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret-value");
    } finally { vi.unstubAllGlobals(); }
  });
});
