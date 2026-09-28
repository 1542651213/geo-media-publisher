import { describe, expect, it } from "vitest";
import { matchExactDouyinRemoteId, type DouyinManagementScanBatch, type DouyinManagementScanRow } from "./image-text-management-match";

const TARGET = "7690435917298928942";
const OTHER = "7690435917298928943";
const title = "装修后为什么要关注甲醛？";
const row = (overrides: Partial<DouyinManagementScanRow> = {}): DouyinManagementScanRow => ({
  title, state: "PUBLISHED", submittedAt: "2026-09-28T04:20:00.000Z", hrefs: [`https://www.douyin.com/note/${TARGET}?from=creator`],
  identityAttributes: {}, imageCount: 1, ...overrides
});
const batch = (scope: string, pageIndex: number, rows: readonly DouyinManagementScanRow[]): DouyinManagementScanBatch =>
  ({ scope, pageIndex, rows });

describe("exact Douyin remote-ID management matching", () => {
  it("finds an exact Published ID in the first or a later page and keeps an actual sanitized href", () => {
    const first = matchExactDouyinRemoteId([batch("已发布", 1, [row()])], TARGET);
    expect(first).toMatchObject({ disposition: "MATCHED", remoteId: TARGET, state: "PUBLISHED",
      matchScope: "已发布", matchHref: `https://www.douyin.com/note/${TARGET}`, scannedPageCount: 1,
      scannedUniqueRowCount: 1, matchConfidence: "EXACT_REMOTE_ID" });
    const second = matchExactDouyinRemoteId([
      batch("已发布", 1, [row({ hrefs: [`https://www.douyin.com/note/${OTHER}`] })]),
      batch("已发布", 2, [row()])
    ], TARGET);
    expect(second).toMatchObject({ disposition: "MATCHED", matchScope: "已发布", scannedPageCount: 2, scannedUniqueRowCount: 2 });
  });

  it.each(["REVIEWING", "REJECTED"] as const)("preserves an exact %s state from row data attributes", (state) => {
    const result = matchExactDouyinRemoteId([
      batch(state, 1, [row({ state, hrefs: [], identityAttributes: { "data-work-id": TARGET } })])
    ], TARGET);
    expect(result).toMatchObject({ disposition: "MATCHED", state, remoteId: TARGET, matchHref: null,
      matchConfidence: "EXACT_REMOTE_ID" });
  });

  it("deduplicates virtualized viewports while counting distinct rows and scopes", () => {
    const targetRow = row({ rowKey: "work-target" });
    const batches = [
      batch("已发布", 1, [row({ rowKey: "other", hrefs: [`https://www.douyin.com/note/${OTHER}`] }), targetRow]),
      batch("已发布", 1, [targetRow]),
      batch("全部", 1, [targetRow])
    ];
    expect(matchExactDouyinRemoteId(batches, TARGET)).toMatchObject({ disposition: "MATCHED", scannedVisibleBatches: 3,
      scannedStatusCount: 2, scannedPageCount: 2, scannedUniqueRowCount: 2 });
  });

  it("ignores same-title rows with another ID and refuses substring ID matches", () => {
    const result = matchExactDouyinRemoteId([batch("已发布", 1, [
      row({ hrefs: [`https://www.douyin.com/note/${OTHER}`] }),
      row({ hrefs: [`https://www.douyin.com/note/${TARGET}9`] })
    ])], TARGET);
    expect(result).toMatchObject({ disposition: "STILL_UNCERTAIN", remoteId: null, matchHref: null,
      scannedUniqueRowCount: 2 });
  });

  it("selects only the trusted ID even when two works share the exact title", () => {
    const result = matchExactDouyinRemoteId([batch("已发布", 1, [
      row({ identityAttributes: { "data-item-id": OTHER }, hrefs: [] }),
      row({ identityAttributes: { "data-id": TARGET }, hrefs: [] })
    ])], TARGET);
    expect(result).toMatchObject({ disposition: "MATCHED", remoteId: TARGET, scannedUniqueRowCount: 2,
      matchConfidence: "EXACT_REMOTE_ID" });
  });

  it("never turns an empty search or a fully traversed bounded scan into not-published", () => {
    expect(matchExactDouyinRemoteId([batch("已发布:search", 1, [])], TARGET).disposition).toBe("STILL_UNCERTAIN");
    expect(matchExactDouyinRemoteId([
      batch("已发布", 1, [row({ hrefs: [`https://www.douyin.com/note/${OTHER}`] })]),
      batch("已发布", 2, []), // pagination end was reached without a target
      batch("审核中", 1, [])
    ],
      TARGET).disposition).toBe("STILL_UNCERTAIN");
  });

  it("treats duplicate same-ID observations consistently, but conflicting status or title as ambiguous", () => {
    const same = [batch("全部", 1, [row()]), batch("已发布", 1, [row()])];
    expect(matchExactDouyinRemoteId(same, TARGET).disposition).toBe("MATCHED");
    expect(matchExactDouyinRemoteId([...same, batch("审核中", 1, [row({ state: "REVIEWING" })])], TARGET)
      .disposition).toBe("AMBIGUOUS");
    expect(matchExactDouyinRemoteId([...same, batch("已发布", 2, [row({ title: "另一篇图文" })])], TARGET)
      .disposition).toBe("AMBIGUOUS");
  });

  it("does not invent a public URL from a data ID or accept an unrelated host", () => {
    const result = matchExactDouyinRemoteId([batch("已发布", 1, [row({ hrefs: [`https://example.com/note/${TARGET}`],
      identityAttributes: { "data-aweme-id": TARGET } })])], TARGET);
    expect(result).toMatchObject({ disposition: "MATCHED", matchHref: null });
  });

  it("marks a row with conflicting work identities ambiguous and rejects a query-only ID", () => {
    const conflict = matchExactDouyinRemoteId([batch("已发布", 1, [row({
      hrefs: [`https://www.douyin.com/video/${OTHER}`], identityAttributes: { "data-aweme-id": TARGET }
    })])], TARGET);
    expect(conflict.disposition).toBe("AMBIGUOUS");
    const queryOnly = matchExactDouyinRemoteId([batch("已发布", 1, [row({
      hrefs: [`https://www.douyin.com/user/search?item_id=${TARGET}`]
    })])], TARGET);
    expect(queryOnly.disposition).toBe("STILL_UNCERTAIN");
  });

  it("does not collapse anonymous same-title rows without a stable row key", () => {
    const result = matchExactDouyinRemoteId([batch("已发布", 1, [row({ hrefs: [], identityAttributes: {} }),
      row({ hrefs: [], identityAttributes: {} })])], TARGET);
    expect(result).toMatchObject({ disposition: "STILL_UNCERTAIN", scannedUniqueRowCount: 2 });
  });
});
