import { describe, expect, it } from "vitest";
import { classifyXhsManagerListDelta, type XhsManagerListDeltaInput, type XhsManagerListRow } from "./manager-list-reconciliation";

const row = (overrides: Partial<XhsManagerListRow> = {}): XhsManagerListRow => ({
  title: "江苏病媒防制服务，沟通前确认五项",
  displayedTime: "2026-09-20T03:05:00.000Z",
  thumbnailFingerprint: "thumb-1",
  rowIdentity: "row-1",
  stableItemId: null,
  href: null,
  noteId: null,
  observedAt: "2026-09-20T03:05:00.000Z",
  creatorId: "960803317",
  ...overrides
});

const input = (overrides: Partial<XhsManagerListDeltaInput> = {}): XhsManagerListDeltaInput => ({
  baseline: [row()],
  current: [row()],
  expectedTitle: row().title,
  expectedCreatorId: "960803317",
  submittedAt: "2026-09-20T03:04:15.000Z",
  windowMs: 10 * 60_000,
  collectorCapability: "VERIFIED",
  ...overrides
});

describe("XHS manager list delta", () => {
  it("does not classify a pre-existing same-title row as a new publication", () => {
    expect(classifyXhsManagerListDelta(input())).toMatchObject({ status: "UNKNOWN_SCHEMA" });
  });

  it("confirms one unique new matching row with complete evidence", () => {
    const candidate = row({ rowIdentity: "row-2", displayedTime: "2026-09-20T03:05:00.000Z", noteId: "note-2", href: "https://www.xiaohongshu.com/explore/note-2?from=manager" });
    expect(classifyXhsManagerListDelta(input({ current: [row(), candidate] }))).toMatchObject({ status: "PUBLISHED_MANAGER_DELTA_CONFIRMED", candidate });
  });

  it("uses noteId before a changing row key", () => {
    const baseline = row({ noteId: "note-1", rowIdentity: "old-row-key" });
    const current = row({ noteId: "note-1", rowIdentity: "new-row-key" });
    expect(classifyXhsManagerListDelta(input({ baseline: [baseline], current: [current] }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
  });

  it("canonicalizes href query changes before comparing baseline", () => {
    const baseline = row({ href: "https://www.xiaohongshu.com/explore/note-1?from=old" });
    const current = row({ href: "https://www.xiaohongshu.com/explore/note-1?from=new" });
    expect(classifyXhsManagerListDelta(input({ baseline: [baseline], current: [current] }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
  });

  it("does not use observedAt as platform publication time", () => {
    const candidate = row({ rowIdentity: "row-2", displayedTime: "2026-09-19T03:05:00.000Z", observedAt: "2026-09-20T03:05:00.000Z", noteId: "note-2" });
    expect(classifyXhsManagerListDelta(input({ current: [row(), candidate] }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
  });

  it("requires an actual thumbnail when the snapshot has an expected fingerprint", () => {
    const candidate = row({ rowIdentity: "row-2", noteId: "note-2", thumbnailFingerprint: null });
    expect(classifyXhsManagerListDelta(input({ current: [row(), candidate], expectedThumbnailFingerprint: "thumb-1" }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
  });

  it("keeps missing identities, conflicts and multiple candidates unknown", () => {
    const missing = row({ rowIdentity: null, stableItemId: null, noteId: null, href: null });
    expect(classifyXhsManagerListDelta(input({ baseline: [], current: [missing] }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
    const first = row({ rowIdentity: "row-2", noteId: "note-2" });
    const second = row({ rowIdentity: "row-3", noteId: "note-3" });
    expect(classifyXhsManagerListDelta(input({ current: [row(), first, second] }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
    expect(classifyXhsManagerListDelta(input({ current: [row(), row({ rowIdentity: "row-2", noteId: "note-2", creatorId: "other" })] }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
  });

  it("does not confirm without a verified collector capability", () => {
    const candidate = row({ rowIdentity: "row-2", noteId: "note-2" });
    expect(classifyXhsManagerListDelta(input({ current: [row(), candidate], collectorCapability: "NOT_VERIFIED" }))).toMatchObject({ status: "UNKNOWN_SCHEMA" });
  });
});
