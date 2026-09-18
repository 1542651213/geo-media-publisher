export interface BoundImageBytes {
  assetId: string;
  name: string;
  mimeType: string;
  sha256: string;
  buffer: Uint8Array;
}
export interface ContentSnapshot {
  id: string;
  purpose: "PRODUCTION" | "ONE_SHOT_ACCEPTANCE";
  platformKey: string;
  contentType: "article";
  accountId: string;
  creatorId: string | null;
  subjectEvidence: "DATABASE_ONLY_NOT_RUNTIME_VERIFIED";
  sourceArticleId: string | null;
  sourceVariantId: string | null;
  operationId: string | null;
  rawTitle: string;
  rawBody: string;
  rawTitleSha256: string;
  rawBodySha256: string;
  canonicalTitle: string;
  canonicalBody: string;
  canonicalTitleSha256: string;
  canonicalBodySha256: string;
  normalizationVersion: "line-endings-v1";
  normalizationReasons: string[];
  summary: string;
  tags: string[];
  images: Array<{ assetId: string; sourcePath: string; sha256: string; name: string; mimeType: string }>;
}
