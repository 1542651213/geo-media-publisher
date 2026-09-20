import { createHash } from "node:crypto";
import type { Page } from "playwright-core";

export interface XhsManagerListRow {
  title: string;
  displayedTime: string | null;
  thumbnailFingerprint: string | null;
  rowIdentity: string | null;
  stableItemId: string | null;
  href: string | null;
  noteId: string | null;
  observedAt: string;
  creatorId: string | null;
}

export interface XhsManagerListDeltaInput {
  baseline: XhsManagerListRow[];
  current: XhsManagerListRow[];
  expectedTitle: string;
  expectedCreatorId: string;
  expectedThumbnailFingerprint?: string | null;
  submittedAt: string;
  windowMs: number;
  collectorCapability?: "VERIFIED" | "NOT_VERIFIED";
}

export type XhsManagerListDeltaResult =
  | { status: "PUBLISHED_MANAGER_DELTA_CONFIRMED"; candidate: XhsManagerListRow }
  | { status: "UNKNOWN_SCHEMA"; reason: string };

export interface XhsManagerListSnapshot {
  rows: XhsManagerListRow[];
  capability: "VERIFIED" | "NOT_VERIFIED";
  capabilityReason: string;
  creatorId: string | null;
  creatorEvidenceSource: "ROW_DOM" | "PAGE_VERIFIED_SESSION" | "NONE";
}

export interface XhsManagerListCollectionOptions {
  observedAt?: string;
  limit?: number;
  pageCreatorId?: string | null;
}

const canonicalHref = (value: string | null): string | null => {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("xiaohongshu.com")) return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/$/u, "") || "/"}`;
  } catch { return null; }
};

const identity = (row: XhsManagerListRow): string | null => {
  if (row.noteId?.trim()) return `note:${row.noteId.trim()}`;
  const href = canonicalHref(row.href);
  if (href) return `href:${href}`;
  if (row.stableItemId?.trim()) return `item:${row.stableItemId.trim()}`;
  if (row.rowIdentity?.trim()) return `row:${row.rowIdentity.trim()}`;
  return null;
};
const parseTime = (value: string | null): number | null => { if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };

/**
 * A strict, read-only manager-list delta contract.  It never turns a same-title
 * historical row into a publication and never fabricates an external id.
 */
export function classifyXhsManagerListDelta(input: XhsManagerListDeltaInput): XhsManagerListDeltaResult {
  const submittedAt = parseTime(input.submittedAt);
  if (input.collectorCapability !== "VERIFIED") return { status: "UNKNOWN_SCHEMA", reason: "MANAGER_LIST_CAPABILITY_NOT_VERIFIED" };
  if (submittedAt === null || input.windowMs < 0 || !input.expectedTitle.trim() || !input.expectedCreatorId.trim()) return { status: "UNKNOWN_SCHEMA", reason: "INVALID_DELTA_INPUT" };
  const baselineIds = new Set(input.baseline.map(identity).filter((value): value is string => Boolean(value)));
  const candidates = input.current.filter((row) => {
    const id = identity(row);
    if (!id || baselineIds.has(id)) return false;
    if (row.title !== input.expectedTitle || row.creatorId !== input.expectedCreatorId) return false;
    if (input.expectedThumbnailFingerprint !== undefined && input.expectedThumbnailFingerprint !== null && row.thumbnailFingerprint !== input.expectedThumbnailFingerprint) return false;
    const displayed = parseTime(row.displayedTime);
    return displayed !== null && displayed >= submittedAt - input.windowMs && displayed <= submittedAt + input.windowMs;
  });
  if (candidates.length !== 1) return { status: "UNKNOWN_SCHEMA", reason: candidates.length === 0 ? "NO_UNIQUE_NEW_MATCH" : "MULTIPLE_NEW_MATCHES" };
  const candidate = candidates[0]!;
  if (input.current.some((row) => row !== candidate && identity(row) === identity(candidate))) return { status: "UNKNOWN_SCHEMA", reason: "DUPLICATE_ROW_IDENTITY" };
  return { status: "PUBLISHED_MANAGER_DELTA_CONFIRMED", candidate };
}

/** Collect only explicit note-card containers from this app-owned Page. */
export async function collectXhsManagerListSnapshot(page: Page, options: XhsManagerListCollectionOptions = {}): Promise<XhsManagerListSnapshot> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const limit = options.limit ?? 20;
  const pageCreatorId = options.pageCreatorId?.trim() || null;
  const raw = await page.evaluate(({ maxRows, verifiedCreatorId }) => {
    const selectors = ["[data-note-id]", "[data-item-id]", "[data-testid='note-card']", "[data-testid='note-card-item']", ".note-card", ".NoteCard", "[class~='note-card']", "[class~='NoteCard']"];
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")));
    const seen = new Set<HTMLElement>();
    return elements.flatMap((element) => {
      if (seen.has(element)) return [];
      seen.add(element);
      const titleElement = element.querySelector<HTMLElement>("[data-title], [data-note-title], [class*='title'], [class*='Title']");
      const title = (titleElement?.innerText || element.getAttribute("data-title") || "").trim();
      if (!title) return [];
      const timeElement = element.querySelector<HTMLElement>("time[datetime], [data-publish-time], [data-time]");
      const displayedTime = timeElement?.getAttribute("datetime") || timeElement?.getAttribute("data-publish-time") || timeElement?.getAttribute("data-time") || timeElement?.innerText.trim() || null;
      const anchor = element.querySelector<HTMLAnchorElement>("a[href]");
      const image = element.querySelector<HTMLImageElement>("img");
      const rowCreatorId = element.getAttribute("data-creator-id")?.trim() || null;
      return [{
        title,
        displayedTime,
        rowIdentity: element.getAttribute("data-row-identity")?.trim() || null,
        stableItemId: element.getAttribute("data-item-id")?.trim() || element.getAttribute("data-itemid")?.trim() || element.getAttribute("data-id")?.trim() || null,
        href: anchor?.href ?? null,
        noteId: element.getAttribute("data-note-id")?.trim() || null,
        thumbnailUrl: image?.currentSrc || image?.src || null,
        creatorId: rowCreatorId || verifiedCreatorId,
        creatorEvidenceSource: rowCreatorId ? "ROW_DOM" : verifiedCreatorId ? "PAGE_VERIFIED_SESSION" : "NONE"
      }];
    }).slice(0, maxRows);
  }, { maxRows: limit, verifiedCreatorId: pageCreatorId });
  const rows = raw.map((row) => ({
    title: row.title,
    displayedTime: row.displayedTime,
    thumbnailFingerprint: row.thumbnailUrl ? createHash("sha256").update(row.thumbnailUrl).digest("hex") : null,
    rowIdentity: row.rowIdentity,
    stableItemId: row.stableItemId,
    href: row.href,
    noteId: row.noteId,
    observedAt,
    creatorId: row.creatorId
  }));
  return { rows, capability: "NOT_VERIFIED", capabilityReason: "LIVE_MANAGER_CARD_SELECTOR_CONTRACT_NOT_VERIFIED", creatorId: pageCreatorId, creatorEvidenceSource: raw.some((row) => row.creatorEvidenceSource === "ROW_DOM") ? "ROW_DOM" : pageCreatorId ? "PAGE_VERIFIED_SESSION" : "NONE" };
}
