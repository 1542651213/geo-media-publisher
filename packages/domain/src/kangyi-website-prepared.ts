export type KangyiWebsiteContentKind = "article" | "case";

export type KangyiPreparedBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string; level: 2 | 3 }
  | { type: "list"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "image"; assetId: string; sha256: string; alt: string };

export interface KangyiPreparedImageBinding {
  assetId: string;
  snapshotSha256: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  alt: string;
  mediaId: null;
}

export interface KangyiWebsiteDraftPreview {
  kind: KangyiWebsiteContentKind;
  slug: string;
  title: string;
  blocks: KangyiPreparedBlock[];
  summary: string;
  category: string;
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
  takeaways: string[];
  showOnHomepage: boolean;
  primaryKeyword?: string;
  location?: string;
  listSummary?: string;
  detailIntro?: string;
}

/** Immutable local Website mapping saved on the existing PublishJob payload. */
export interface KangyiWebsitePreparedContentV1 {
  version: 1;
  articleId: string;
  brandId: string;
  accountId: string;
  snapshotId: string;
  contentBindingId: string;
  siteId: "kangyi" | "huiquan" | "shupai";
  environment: "staging" | "production" | "local";
  kind: KangyiWebsiteContentKind;
  slug: string;
  draftPreview: KangyiWebsiteDraftPreview;
  imageBindings: KangyiPreparedImageBinding[];
}
