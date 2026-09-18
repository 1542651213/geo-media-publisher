export const PLATFORM_CONTENT_RULE_VERIFICATION_STATUSES = ["verified", "unverified"] as const;
export type PlatformContentRuleVerificationStatus = (typeof PLATFORM_CONTENT_RULE_VERIFICATION_STATUSES)[number];

export type PlatformContentType = "article" | "video_script" | "mixed";

export interface PlatformContentRules {
  platformKey: string;
  titleMinLength: number;
  titleMaxLength: number;
  bodyMinLength: number;
  bodyMaxLength: number;
  summaryMaxLength: number;
  maxTags: number;
  maxImages: number;
  supportsLinks: boolean;
  supportsMarkdown: boolean;
  supportsHtml: boolean;
  contentType: PlatformContentType;
  source: string | null;
  lastVerifiedAt: string | null;
  verificationStatus: PlatformContentRuleVerificationStatus;
}

export const CONTENT_STUDIO_PLATFORM_RULE_KEYS = [
  "wechat_official",
  "zhihu",
  "toutiao",
  "weibo",
  "douyin",
  "bilibili"
] as const;

export function conservativePlatformContentRules(platformKey: string, contentType: PlatformContentType = "article"): PlatformContentRules {
  return {
    platformKey,
    titleMinLength: 1,
    titleMaxLength: 40,
    bodyMinLength: 80,
    bodyMaxLength: 2000,
    summaryMaxLength: 120,
    maxTags: 5,
    maxImages: 1,
    supportsLinks: false,
    supportsMarkdown: false,
    supportsHtml: false,
    contentType,
    source: null,
    lastVerifiedAt: null,
    verificationStatus: "unverified"
  };
}
