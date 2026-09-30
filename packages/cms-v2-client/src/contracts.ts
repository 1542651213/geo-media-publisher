export type DeployEnvironment = "local" | "staging" | "production";
export type ContentKind = "article" | "case";
export type JobStatus = "queued" | "processing" | "verifying" | "succeeded" | "failed" | "needs_attention";
export type RevisionBinding = { contentId: string; revisionId: string; contentHash: string; rowVersion: number };
export interface CmsDraft { kind: ContentKind; slug: string; title: string; blocks: Array<{ type: string; text?: string; items?: string[]; mediaId?: string; alt?: string; level?: number }>; [key: string]: unknown }
export interface CmsRecord extends RevisionBinding { id: string; siteId: string; environment: DeployEnvironment; kind: ContentKind; slug: string; externalId: string | null; principalId: string; draftRevisionId: string; publishedRevisionId: string | null; deletedAt: string | null; draft: CmsDraft }
export interface FieldError { field: string; message: string }
export interface Success<T> { ok: true; data: T; requestId: string }
export interface Failure { ok: false; error: { code: string; message: string; retryable: boolean; fieldErrors?: FieldError[] }; requestId: string }
export interface Capabilities { siteId: string; environment: DeployEnvironment; protocolVersion: string; contentKinds: ContentKind[]; limits: { jsonBytes: number; mediaBytes: number; imagePixels: number; imageDimension: number }; writesEnabled: boolean }
export interface Media { mediaId: string; sha256: string; mime: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number; bytes: number }
export interface ContentList { items: CmsRecord[]; total: number; page: number; pageSize: number }
export interface CreateContent { externalId?: string; draft: CmsDraft }
export interface SaveDraft { rowVersion: number; draft: CmsDraft }
export interface Publish { revisionId: string; contentHash: string; rowVersion: number }
export interface ExpectedPublished { rowVersion: number; expectedPublishedRevisionId: string | null }
export interface Rollback extends Publish { expectedPublishedRevisionId: string | null }
export interface DeleteContent extends ExpectedPublished { reason?: string }
export interface Purge { rowVersion: number; acceptanceRunId?: string }
export interface Validation { valid: boolean; contentId: string; revisionId: string; contentHash: string; fieldErrors?: FieldError[] }
export type Operation = "publish" | "unpublish" | "rollback" | "delete" | "restore" | "purge";
export interface Job { jobId: string; operation: Operation; siteId: string; environment: DeployEnvironment; contentId: string; revisionId: string | null; contentHash: string | null; status: JobStatus; publicUrl: string | null; previousRevisionId: string | null; verification: Record<string, unknown> | null; error: { code: string; message: string } | null; createdAt: string; finishedAt: string | null }
