import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOfficialApiAcceptance, candidateBindingAllowed, OFFICIAL_API_ACCEPTANCE_MARKER } from "../apps/desktop/src/main/official-api-candidate";

const selection = { accountId: "account", articleId: "article", siteId: "kangyi", environment: "production", keyId: "fixture", kind: "article", contentBindingId: "a".repeat(64) };
afterEach(() => vi.restoreAllMocks());
describe("Website bounded Candidate authority", () => {
  it("expires retained authorization in a process that remains open beyond marker expiry", () => {
    const dir = mkdtempSync(join(tmpdir(), "geo-website-candidate-expiry-"));
    try {
      const now = Date.now();
      writeFileSync(join(dir, OFFICIAL_API_ACCEPTANCE_MARKER), JSON.stringify({ purpose: "R1.15-C-OFFICIALAPI-ACCEPTANCE", version: 1,
        expiresAt: new Date(now + 1000).toISOString(), selections: [selection] }));
      const retained = readOfficialApiAcceptance(true, dir);
      expect(candidateBindingAllowed(retained, selection)).toBe(true);
      vi.spyOn(Date, "now").mockReturnValue(now + 2000);
      expect(candidateBindingAllowed(retained, selection)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("requires a packaged unexpired strict marker and never accepts Renderer authority", () => {
    const dir = mkdtempSync(join(tmpdir(), "geo-website-candidate-"));
    try {
      expect(readOfficialApiAcceptance(true, dir)).toEqual([]);
      const marker = { purpose: "R1.15-C-OFFICIALAPI-ACCEPTANCE", version: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), selections: [selection] };
      writeFileSync(join(dir, OFFICIAL_API_ACCEPTANCE_MARKER), JSON.stringify(marker));
      expect(readOfficialApiAcceptance(false, dir)).toEqual([]);
      const grants = readOfficialApiAcceptance(true, dir);
      expect(grants).toHaveLength(1);
      expect(candidateBindingAllowed(grants, selection)).toBe(true);
      for (const changed of [{ articleId: "other" }, { accountId: "other" }, { environment: "staging" }, { keyId: "other" }, { contentBindingId: "b".repeat(64) }])
        expect(candidateBindingAllowed(grants, { ...selection, ...changed })).toBe(false);
      writeFileSync(join(dir, OFFICIAL_API_ACCEPTANCE_MARKER), JSON.stringify({ ...marker, expiresAt: new Date(0).toISOString() }));
      expect(readOfficialApiAcceptance(true, dir)).toEqual([]);
      writeFileSync(join(dir, OFFICIAL_API_ACCEPTANCE_MARKER), JSON.stringify({ ...marker, secret: "renderer" }));
      expect(readOfficialApiAcceptance(true, dir)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects a second production object and a production purge grant", () => {
    const dir = mkdtempSync(join(tmpdir(), "geo-website-candidate-"));
    try {
      for (const selections of [[selection, { ...selection, articleId: "second" }], [{ ...selection, acceptanceRunId: "00000000-0000-4000-8000-000000000001" }]]) {
        writeFileSync(join(dir, OFFICIAL_API_ACCEPTANCE_MARKER), JSON.stringify({ purpose: "R1.15-C-OFFICIALAPI-ACCEPTANCE", version: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), selections }));
        expect(readOfficialApiAcceptance(true, dir)).toEqual([]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
