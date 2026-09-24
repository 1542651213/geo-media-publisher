import { describe, expect, it, vi } from "vitest";
import { probeAcrCrawlerInputContractInPage } from "./protocol-signer-input-probe";

describe("Toutiao signer dummy input contract diagnostics", () => {
  it("compares URL, query, body, and repeated input using hashes only", async () => {
    const sign = vi.fn((input?: unknown) => {
      if (input === undefined) throw new TypeError("url is required; secret-message");
      return `signature-secret:${JSON.stringify(input)}`;
    });
    vi.stubGlobal("window", { byted_acrawler: { sign } });
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("MutationObserver", class { observe(): void {} disconnect(): void {} takeRecords(): [] { return []; } });
    vi.stubGlobal("localStorage", { length: 0, key: () => null, getItem: () => null });
    vi.stubGlobal("sessionStorage", { length: 0, key: () => null, getItem: () => null });
    try {
      const result = await probeAcrCrawlerInputContractInPage();
      expect(result.probes.map((probe) => probe.inputShape)).toEqual([
        "NO_ARGUMENTS", "EMPTY_OBJECT", "URL_TEST_1", "URL_TEST_2", "URL_TEST_A", "URL_TEST_B",
        "QUERY_EMPTY", "QUERY_A1", "BODY_A", "BODY_B"
      ]);
      expect(result.probes[2]?.outputSha256).toBe(result.probes[3]?.outputSha256);
      expect(result.probes[4]?.outputSha256).not.toBe(result.probes[5]?.outputSha256);
      expect(result.probes[6]?.outputSha256).not.toBe(result.probes[7]?.outputSha256);
      expect(result.probes[8]?.outputSha256).not.toBe(result.probes[9]?.outputSha256);
      expect(result.probes[0]?.exceptionCategory).toBe("URL_ARGUMENT_REQUIRED");
      expect(JSON.stringify(result)).not.toMatch(/signature-secret|secret-message/u);
      expect(sign).toHaveBeenCalledTimes(10);
    } finally { vi.unstubAllGlobals(); }
  });

  it("detects synchronous storage changes without returning keys or values", async () => {
    const values = new Map<string, string>();
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null };
    vi.stubGlobal("window", { byted_acrawler: { sign: () => { values.set("secret-key-name", "secret-value"); return "signature-secret"; } } });
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("MutationObserver", class { observe(): void {} disconnect(): void {} takeRecords(): [] { return []; } });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", { length: 0, key: () => null, getItem: () => null });
    try {
      const result = await probeAcrCrawlerInputContractInPage();
      expect(result.probes[0]?.localStorageDiff.addedCount).toBe(1);
      expect(result.probes[0]?.localStorageDiff.addedKeyHashes).toHaveLength(1);
      expect(JSON.stringify(result)).not.toMatch(/secret-key-name|secret-value|signature-secret/u);
    } finally { vi.unstubAllGlobals(); }
  });
});
