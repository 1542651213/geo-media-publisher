export const DRAFT_DOCUMENT_KINDS = ["Article", "StudioGeneration"] as const;
export type DraftDocumentKind = typeof DRAFT_DOCUMENT_KINDS[number];
export const DRAFT_COPY_STATUSES = ["Editing", "Recovered", "Conflict", "Committed", "Discarded"] as const;
export type DraftCopyStatus = typeof DRAFT_COPY_STATUSES[number];

/** Complete editable fields for the existing Article and Product Studio editors. */
export interface DraftEditSnapshot { title: string; body: string }
export interface DraftDocumentRef { companyId: string; documentKind: DraftDocumentKind; documentId: string }
export interface DraftCopyRef { companyId: string; copyId: string }
export interface DraftCopyVersionRef extends DraftCopyRef { localVersion: number }
export interface DraftOpenInput extends DraftDocumentRef { copyId?: string }
export interface DraftPersistInput extends DraftCopyVersionRef { baseVersion: string; snapshot: DraftEditSnapshot }
export interface DraftCommitInput extends DraftCopyVersionRef { baseVersion: string }
export interface DraftResolutionInput extends DraftCopyVersionRef {
  choice: "current" | "recovered";
  expectedCurrentVersion: string;
}
export interface DraftWorkingCopy extends DraftDocumentRef {
  copyId: string;
  baseVersion: string;
  localVersion: number;
  baseSnapshot: DraftEditSnapshot;
  snapshot: DraftEditSnapshot;
  currentVersion: string;
  currentSnapshot: DraftEditSnapshot;
  hasChanges: boolean;
  canonicalMissing?:boolean;
  activeEditing: boolean;
  status: DraftCopyStatus;
  createdAt: string;
  updatedAt: string;
  persistedAt: string;
}
export interface DraftCommitResult extends DraftDocumentRef {
  copyId: string;
  localVersion: number;
  articleId: string;
  variantId: string | null;
  status: "Committed";
  persistedAt: string;
}
export type DraftWorkingCopyErrorCode = "DRAFT_COMPANY_MISMATCH" | "DRAFT_DOCUMENT_NOT_FOUND" | "DRAFT_COPY_NOT_FOUND"
  | "DRAFT_VERSION_STALE" | "DRAFT_CANONICAL_CONFLICT" | "DRAFT_COPY_CLOSED" | "DRAFT_PERSIST_FAILED"
  | "DRAFT_INPUT_INVALID" | "DRAFT_UNSUBMITTED_EDITS" | "DRAFT_STUDIO_UNAVAILABLE";

/** Preload exposes only typed business DTOs; Renderer never reads SQLite or files. */
export interface DraftWorkingCopiesApi {
  open(input: DraftOpenInput): Promise<DraftWorkingCopy>;
  get(input: DraftCopyRef): Promise<DraftWorkingCopy>;
  persist(input: DraftPersistInput): Promise<DraftWorkingCopy>;
  listRecovery(input: { companyId: string }): Promise<DraftWorkingCopy[]>;
  commit(input: DraftCommitInput): Promise<DraftCommitResult>;
  discard(input: DraftCopyVersionRef): Promise<DraftWorkingCopy>;
  release(input: DraftCopyVersionRef): Promise<DraftWorkingCopy>;
  resolve(input: DraftResolutionInput): Promise<DraftWorkingCopy>;
}
