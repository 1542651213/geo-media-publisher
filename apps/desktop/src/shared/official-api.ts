export interface OfficialApiAccountView {
  accountId: string;
  connectionMode: "OfficialAPI";
  configured: boolean;
  status: "MISSING" | "DECRYPT_FAILED" | "UNVERIFIED" | "CONNECTED" | "READ_ONLY";
  siteId: string | null;
  environment: "staging" | "production" | null;
  baseUrl: string | null;
  keyId: string | null;
  apiVersion: string | null;
  writesEnabled: boolean;
  contentTypes: Array<"article" | "case">;
  lastVerifiedAt: string | null;
}

export interface OfficialApiCandidateSelection {
  accountId: string;
  articleId: string;
  kind: "article" | "case";
}

export interface OfficialApiImageChoice { id: string; brandId: string | null; universal: boolean; enabled: boolean; name: string }

export interface OfficialApiAvailability {
  ordinaryEnabled: boolean;
  candidateSelections: OfficialApiCandidateSelection[];
}

export interface OfficialApiContentSettings {
  version: 1;
  kind: "article" | "case";
  summary?: string;
  slug?: string;
  category?: string;
  seoTitle?: string;
  seoDescription?: string;
  keywords?: string[];
  takeaways?: string[];
  location?: string;
  detailIntro?: string;
  serviceFocus?: string[];
  coverAssetId: string | null;
  bodyImageAssetIds: string[];
  galleryAssetIds: string[];
}

export interface OfficialApiJobView {
  jobId: string;
  phase: string;
  contentId: string | null;
  revisionId: string | null;
  contentHash: string | null;
  rowVersion: number | null;
  remoteJobId: string | null;
  publicUrl: string | null;
  kind: "article" | "case";
  siteId: string;
  environment: "staging" | "production";
  publicContentVerified: boolean | null;
  fidelityWarning: string | null;
  errorCode: string | null;
  canPurge: boolean;
}

export type OfficialApiMaintenanceOperation = "unpublish" | "delete" | "restore" | "purge";
