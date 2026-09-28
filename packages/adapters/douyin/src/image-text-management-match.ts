export type DouyinManagementObservedState = "PUBLISHED" | "REVIEWING" | "REJECTED";

export interface DouyinManagementScanRow {
  title: string;
  state: DouyinManagementObservedState | null;
  submittedAt: string | null;
  hrefs: readonly string[];
  identityAttributes: Readonly<Record<string, string>>;
  imageCount: number | null;
  rowKey?: string;
}

export interface DouyinManagementScanBatch {
  scope: string;
  pageIndex: number;
  rows: readonly DouyinManagementScanRow[];
}

export interface DouyinExactRemoteIdMatch {
  disposition: "MATCHED" | "AMBIGUOUS" | "STILL_UNCERTAIN";
  remoteIdFound: boolean;
  remoteId: string | null;
  state: DouyinManagementObservedState | null;
  matchScope: string | null;
  matchHref: string | null;
  matchTitle: string | null;
  matchTime: string | null;
  matchConfidence: "EXACT_REMOTE_ID" | null;
  scannedStatusCount: number;
  scannedPageCount: number;
  scannedVisibleBatches: number;
  scannedUniqueRowCount: number;
}

const ID_PATTERN = /^\d{10,30}$/u;
const ID_ATTRIBUTES = new Set(["data-aweme-id", "data-awemeid", "data-item-id", "data-itemid",
  "data-work-id", "data-workid", "data-id"]);
const PUBLIC_WORK_PATH = /^\/(?:video|note)\/(\d{10,30})(?:\/|$)/u;

function douyinWorkHref(raw: string): { remoteId: string; href: string } | null {
  // Only a real work URL can become public evidence. Query strings and fragments may contain tracking tokens.
  if (!/^https:\/\//u.test(raw) && !raw.startsWith("/")) return null;
  let parsed: URL;
  try { parsed = new URL(raw, "https://creator.douyin.com"); } catch { return null; }
  if (parsed.protocol !== "https:" || (parsed.hostname !== "douyin.com" && !parsed.hostname.endsWith(".douyin.com"))) return null;
  const id = PUBLIC_WORK_PATH.exec(parsed.pathname)?.[1];
  if (!id) return null;
  return { remoteId: id, href: `${parsed.origin}${parsed.pathname}` };
}

function rowIdentity(row: DouyinManagementScanRow): { ids: Set<string>; workHrefs: Map<string, Set<string>> } {
  const ids = new Set<string>();
  const workHrefs = new Map<string, Set<string>>();
  for (const [key, value] of Object.entries(row.identityAttributes)) {
    if (ID_ATTRIBUTES.has(key.toLowerCase()) && ID_PATTERN.test(value)) ids.add(value);
  }
  for (const raw of row.hrefs) {
    const work = douyinWorkHref(raw);
    if (!work) continue;
    ids.add(work.remoteId);
    const hrefs = workHrefs.get(work.remoteId) ?? new Set<string>();
    hrefs.add(work.href);
    workHrefs.set(work.remoteId, hrefs);
  }
  return { ids, workHrefs };
}

export function matchExactDouyinRemoteId(batches: readonly DouyinManagementScanBatch[], expectedRemoteId: string): DouyinExactRemoteIdMatch {
  const statuses = new Set<string>();
  const pages = new Set<string>();
  const uniqueRows = new Set<string>();
  const matching: Array<{ row: DouyinManagementScanRow; scope: string; hrefs: ReadonlySet<string>; conflictingIds: boolean }> = [];
  let anonymousIndex = 0;
  for (const batch of batches) {
    statuses.add(batch.scope);
    pages.add(`${batch.scope}\u0000${batch.pageIndex}`);
    for (const row of batch.rows) {
      const identity = rowIdentity(row);
      const soleId = identity.ids.size === 1 ? [...identity.ids][0] : null;
      // Without a stable row identity, counting the occurrence is safer than merging two same-title works.
      const key = soleId ? `id:${soleId}` : row.rowKey ? `key:${row.rowKey}` : `anonymous:${anonymousIndex++}`;
      uniqueRows.add(key);
      if (ID_PATTERN.test(expectedRemoteId) && identity.ids.has(expectedRemoteId)) {
        matching.push({ row, scope: batch.scope, hrefs: identity.workHrefs.get(expectedRemoteId) ?? new Set<string>(),
          conflictingIds: identity.ids.size > 1 });
      }
    }
  }
  const base: DouyinExactRemoteIdMatch = {
    disposition: "STILL_UNCERTAIN", remoteIdFound: matching.length > 0, remoteId: matching.length ? expectedRemoteId : null,
    state: null, matchScope: null, matchHref: null, matchTitle: null, matchTime: null,
    matchConfidence: null, scannedStatusCount: statuses.size, scannedPageCount: pages.size,
    scannedVisibleBatches: batches.length, scannedUniqueRowCount: uniqueRows.size
  };
  if (!matching.length) return base;
  const first = matching[0]!;
  const title = first.row.title;
  const state = first.row.state;
  if (matching.some((entry) => entry.conflictingIds || entry.row.title !== title || entry.row.state !== state)) {
    return { ...base, disposition: "AMBIGUOUS" };
  }
  if (state === null) return base;
  const hrefs = new Set(matching.flatMap((entry) => [...entry.hrefs]));
  return { ...base, disposition: "MATCHED", state, matchScope: first.scope, matchTitle: title,
    matchTime: matching.find((entry) => entry.row.submittedAt)?.row.submittedAt ?? null,
    matchHref: hrefs.size === 1 ? [...hrefs][0]! : null, matchConfidence: "EXACT_REMOTE_ID" };
}
