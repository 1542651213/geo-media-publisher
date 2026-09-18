import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ScopedXhsCampaignLedger } from "../apps/desktop/src/main/xhs-max3-ledger";

const content = ["XHS-01", "XHS-02", "XHS-03"].map((slot, index) => ({ slot, titleSha256: `title${index}`, bodySha256: `body${index}`, imageSha256: `image${index}` }));
const cfg = { campaignId: "GEO_XHS_SOL_MAX3_20260917", accountId: "11111111-1111-4111-8111-111111111111", creatorId: "123456789", expiresAtUtc: "2026-09-17T14:59:59Z", content };
const binding = (n: number) => ({ slot: `XHS-0${n}`, accountId: cfg.accountId, creatorId: cfg.creatorId, jobId: `job-${n}`, intentId: `intent-${n}`, snapshotId: `snapshot-${n}`, titleSha256: `title${n-1}`, bodySha256: `body${n-1}`, imageSha256: `image${n-1}`, buildSha256: "build" });
const now = () => Date.parse("2026-09-17T10:00:00Z");

describe("scoped XHS campaign ledger", () => {
  it("refuses a fourth slot, repeat slot and next slot before reliable Published", () => {
    const root = mkdtempSync(join(tmpdir(), "xhs-max3-ledger-"));
    const ledger = ScopedXhsCampaignLedger.open(root, cfg, now);
    expect(() => ledger.reserve(binding(2))).toThrow();
    ledger.reserve(binding(1));
    expect(() => ledger.reserve(binding(1))).toThrow();
    expect(() => ledger.reserve(binding(2))).toThrow();
    ledger.mark("XHS-01", "finalBoundaryClaimed");
    ledger.mark("XHS-01", "mouseActionInvoked");
    ledger.mark("XHS-01", "requestObserved");
    ledger.mark("XHS-01", "platformAccepted", { externalId: "x1" });
    ledger.mark("XHS-01", "published", { externalId: "x1" });
    ledger.reserve(binding(2));
    expect(() => ledger.reserve({ ...binding(2), slot: "XHS-04" })).toThrow();
    ledger.close();
  });

  it("keeps a reserved slot consumed across orderly restart and blocks after Unknown", () => {
    const root = mkdtempSync(join(tmpdir(), "xhs-max3-ledger-"));
    const first = ScopedXhsCampaignLedger.open(root, cfg, now);
    first.reserve(binding(1)); first.close();
    const second = ScopedXhsCampaignLedger.open(root, cfg, now);
    expect(second.snapshot().slots["XHS-01"]?.stage).toBe("slotReserved");
    expect(() => second.reserve(binding(1))).toThrow();
    second.mark("XHS-01", "unknown");
    expect(() => second.reserve(binding(2))).toThrow();
    second.close();
  });

  it("fails closed on mismatched subject/content, ledger mutation, DB mismatch, expiry and concurrent lock", () => {
    const root = mkdtempSync(join(tmpdir(), "xhs-max3-ledger-"));
    const first = ScopedXhsCampaignLedger.open(root, cfg, now);
    expect(() => first.reserve({ ...binding(1), creatorId: "other" })).toThrow();
    expect(() => first.reserve({ ...binding(1), imageSha256: "other" })).toThrow();
    expect(() => ScopedXhsCampaignLedger.open(root, cfg, now)).toThrow();
    first.reserve(binding(1));
    expect(() => first.assertDatabaseConsistency([{ jobId: "other", intentId: "other", finalSubmitCount: 1 }])).toThrow();
    first.close();
    const path = join(root, "campaign-ledger.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace("job-1", "job-x"));
    expect(() => ScopedXhsCampaignLedger.open(root, cfg, now)).toThrow();
    const later = () => Date.parse("2026-09-17T15:00:00Z");
    const other = mkdtempSync(join(tmpdir(), "xhs-max3-ledger-"));
    const expired = ScopedXhsCampaignLedger.open(other, cfg, later);
    expect(() => expired.reserve(binding(1))).toThrow();
    expired.close();
  });
  it("does not append an invalid transition that poisons a healthy ledger", () => {
    const root = mkdtempSync(join(tmpdir(), "xhs-max3-ledger-"));
    const first = ScopedXhsCampaignLedger.open(root, cfg, now);
    first.reserve(binding(1));
    expect(() => first.mark("XHS-01", "platformAccepted")).toThrow("external ID required");
    first.close();
    const reopened = ScopedXhsCampaignLedger.open(root, cfg, now);
    expect(reopened.snapshot().slots["XHS-01"]?.stage).toBe("slotReserved");
    reopened.close();
  });
});
