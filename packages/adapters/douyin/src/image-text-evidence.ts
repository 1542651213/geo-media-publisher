export type DouyinVisibility = "public" | "followers" | "private" | "unknown";
export type DouyinTiming = "immediate" | "scheduled" | "unknown";

export interface DouyinEditorSettingsSnapshot {
  visibility: DouyinVisibility;
  visibilitySelected: boolean;
  timing: DouyinTiming;
  timingSelected: boolean;
  requiredEmptyCount: number;
  unknownMandatoryCount: number;
  selectedMandatory: readonly { key: string; value: string }[];
}

/** A visible label is insufficient: the matching setting control must report selected state. */
export function assertDouyinEditorSettings(snapshot: DouyinEditorSettingsSnapshot, intendedVisibility: Exclude<DouyinVisibility, "unknown">): void {
  if (snapshot.visibility !== intendedVisibility || !snapshot.visibilitySelected) throw new Error("VISIBILITY_NOT_SELECTED");
  if (snapshot.timing !== "immediate" || !snapshot.timingSelected) throw new Error("TIMING_MISMATCH");
  if (snapshot.requiredEmptyCount > 0) throw new Error("REQUIRED_SETTING_EMPTY");
  if (snapshot.unknownMandatoryCount > 0) throw new Error("MANDATORY_SETTING_UNKNOWN");
}

export function protectExistingDouyinDraft(visibleText: string): void {
  if (/上次未发布|未发布的图文|继续编辑/u.test(visibleText)) throw new Error("EXISTING_UNPUBLISHED_ITEM");
}

export interface DouyinUploadEvidence {
  preUploadImageCount: number;
  postUploadImageCount: number;
  selectedFileName: string;
  uploadInputFileName: string | null;
  imageVisible: boolean;
  imageLoaded: boolean;
  processing: boolean;
  error: boolean;
  currentEditorRoute: boolean;
  contextOwned: boolean;
}

export function verifyDouyinUploadEvidence(evidence: DouyinUploadEvidence): void {
  if (!evidence.contextOwned || !evidence.currentEditorRoute) throw new Error("CONTEXT_MISMATCH");
  if (evidence.preUploadImageCount !== 0 || evidence.postUploadImageCount !== 1) throw new Error("IMAGE_COUNT_MISMATCH");
  if (!evidence.selectedFileName || evidence.uploadInputFileName !== evidence.selectedFileName) throw new Error("FILE_ASSOCIATION_MISMATCH");
  if (!evidence.imageVisible || !evidence.imageLoaded || evidence.processing || evidence.error) throw new Error("PROCESSING_INCOMPLETE");
}

export interface DouyinPublishResponseEvidence {
  finalClickCount: number;
  requestCount: number;
  responseObserved: boolean;
  httpStatus: number | null;
  statusCode: number | null;
  itemId: string | null;
  samePage: boolean;
  afterFinalAction: boolean;
}

export function classifyDouyinPublishResponse(evidence: DouyinPublishResponseEvidence): { status: "ACCEPTED" | "UNKNOWN"; remoteId: string | null } {
  const accepted = evidence.finalClickCount === 1 && evidence.requestCount === 1 && evidence.responseObserved
    && evidence.httpStatus !== null && evidence.httpStatus >= 200 && evidence.httpStatus < 300
    && evidence.statusCode === 0 && evidence.samePage && evidence.afterFinalAction
    && typeof evidence.itemId === "string" && /^\d{10,30}$/u.test(evidence.itemId);
  return accepted ? { status: "ACCEPTED", remoteId: evidence.itemId } : { status: "UNKNOWN", remoteId: null };
}

export type DouyinManagementState = "PUBLISHED" | "REVIEWING" | "REJECTED" | "DRAFT" | "SCHEDULED" | "NOT_FOUND" | "UNKNOWN" | "AMBIGUOUS";
export interface DouyinManagementRow {
  remoteId: string | null;
  title: string;
  description: string;
  state: Exclude<DouyinManagementState, "NOT_FOUND" | "UNKNOWN" | "AMBIGUOUS">;
  submittedAt: string | null;
  publicUrl: string | null;
  imageCount: number | null;
}
export interface DouyinManagementQuery {
  remoteId: string | null;
  title: string;
  windowStart: string;
  windowEnd: string;
  scopeComplete: boolean;
}
export interface DouyinManagementMatch { state: DouyinManagementState; remoteId: string | null; publicUrl: string | null; matchedBy: "REMOTE_ID" | "TITLE_TIME" | null; }

const normalized = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
export function matchDouyinManagementRows(rows: readonly DouyinManagementRow[], query: DouyinManagementQuery): DouyinManagementMatch {
  const unknown: DouyinManagementMatch = { state: "UNKNOWN", remoteId: null, publicUrl: null, matchedBy: null };
  const candidates = query.remoteId
    ? rows.filter((row) => row.remoteId === query.remoteId)
    : rows.filter((row) => {
      const title = normalized(query.title);
      const time = row.submittedAt ? Date.parse(row.submittedAt) : Number.NaN;
      return Boolean(title) && (normalized(row.title) === title || normalized(row.description) === title)
        && Number.isFinite(time) && time >= Date.parse(query.windowStart) && time <= Date.parse(query.windowEnd);
    });
  if (candidates.length > 1) return { ...unknown, state: "AMBIGUOUS" };
  if (candidates.length === 0) return { ...unknown, state: query.scopeComplete ? "NOT_FOUND" : "UNKNOWN" };
  if (!query.remoteId && !query.scopeComplete) return unknown;
  const row = candidates[0]!;
  if (row.state === "PUBLISHED" && !row.remoteId) return unknown;
  return { state: row.state, remoteId: row.remoteId, publicUrl: row.publicUrl,
    matchedBy: query.remoteId ? "REMOTE_ID" : "TITLE_TIME" };
}
