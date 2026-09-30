import { CONTENT_STUDIO_PLATFORMS, type Account, type Platform, type PublishJob } from "@publisher/domain";

export interface ProductPlatformDefinition {
  platformKey: string;
  displayName: string;
  order: number;
  visibleInOperatorUi: boolean;
  accountManagementVisible: boolean;
  publishSelectorVisible: boolean;
  dashboardVisible: boolean;
  statisticsVisible: boolean;
  automationStatus: string;
  ordinaryPublishEnabled: boolean;
  batchPublishEnabled: boolean;
  statusLabel: string;
  statusDescription: string;
  publishBlockReason: string;
}

const define = (platformKey: string, displayName: string, order: number, automationStatus: string, statusLabel: string, statusDescription: string, publishBlockReason: string): ProductPlatformDefinition => ({
  platformKey, displayName, order, visibleInOperatorUi: true, accountManagementVisible: true,
  publishSelectorVisible: true, dashboardVisible: true, statisticsVisible: true,
  automationStatus, ordinaryPublishEnabled: false, batchPublishEnabled: false,
  statusLabel, statusDescription, publishBlockReason
});

export const PRODUCT_PLATFORM_POLICY: readonly ProductPlatformDefinition[] = [
  { ...define("douyin", "抖音", 1, "PRODUCT_E2E_PUBLISHED", "图文可发布", "单账号、单图、标题最多20字符、公开、立即发布、无音乐。", ""), ordinaryPublishEnabled: true },
  define("xiaohongshu", "小红书", 2, "PRODUCT_E2E_PENDING", "正式链路待验收", "普通生产链路尚未完整验收。", "小红书正式生产链路尚未完整验收"),
  define("website", "官网", 3, "API_CONNECTION_PENDING", "API 发布待验收", "已接入 Main 安全凭据导入与只读连接校验；真实发布尚未验收。", "官网 API 发布尚未验收，普通提交仍关闭"),
  define("toutiao", "今日头条", 4, "HISTORICALLY_CONFIRMED", "普通 UI 待验收", "历史限定路线已确认；普通正式提交仍关闭。", "今日头条普通 UI Product E2E 尚未完成，正式提交开关关闭"),
  define("sohu_media", "搜狐号", 5, "HISTORY_VERIFIED", "普通 UI 待复验", "历史 Published / Verified；普通 UI 尚待复验。", "搜狐号普通 UI 尚待产品复验"),
  define("netease_media", "网易号", 6, "NOT_IMPLEMENTED", "待开发", "当前只有平台目录占位，尚无独立 Adapter。", "网易号待开发，当前不可发布"),
  define("baijiahao", "百家号", 7, "EDITOR_NOT_VERIFIED", "编辑器待验证", "CONTENT_EDITOR_NOT_VERIFIED。", "百家号编辑器能力尚未完成验收"),
  define("weibo", "微博", 8, "HISTORY_PASSED", "普通 UI 待复验", "历史真实 PublishPassed=PASS；普通 UI 尚待复验。", "微博普通 UI 尚待产品复验"),
  define("lieju", "列举网", 9, "VERIFICATION_PENDING", "风控验证待完成", "账号与平台安全验证仍需 Owner 完成。", "列举网风控与验证尚未完成"),
  define("cnblogs", "博客园", 10, "API_BASE_READY", "Product E2E 待完成", "已有 API 基础；普通产品路径尚待验收。", "博客园普通产品 E2E 尚未完成")
];

const byKey = new Map(PRODUCT_PLATFORM_POLICY.map((item) => [item.platformKey, item]));

export const operatorContentStudioTargets = CONTENT_STUDIO_PLATFORMS.filter((item) => item.contentType === "article" && byKey.get(item.key)?.visibleInOperatorUi);

export const operatorPlatformKeys = (): string[] => PRODUCT_PLATFORM_POLICY.map((item) => item.platformKey);
export const productPlatform = (key: string): ProductPlatformDefinition | undefined => byKey.get(key);
export const operatorFavoriteKeys = (keys: readonly string[]): string[] => keys.filter((key) => byKey.has(key));
export const operatorAccounts = <T extends Pick<Account, "platformKey">>(accounts: readonly T[]): T[] => accounts.filter((account) => byKey.get(account.platformKey)?.accountManagementVisible === true);
export const operatorOverviewJobs = <T extends Pick<PublishJob, "platformKey">>(jobs: readonly T[]): T[] => jobs.filter((job) => byKey.get(job.platformKey)?.dashboardVisible === true);

const missingPlatform = (definition: ProductPlatformDefinition): Platform => ({
  id: `operator-placeholder:${definition.platformKey}`,
  platformKey: definition.platformKey,
  displayName: definition.displayName,
  category: "待接入",
  enabled: false,
  adapterStatus: "not_implemented",
  authStrategy: "Unsupported",
  callbackStrategy: "ManualCodeCallback",
  adapterVersion: "",
  capabilities: { article: false, imagePost: false, video: false, coverImage: false, tags: false, categories: false, scheduledPublish: false, draft: false, markdown: false, richText: false, maxTitleLength: 0, maxImageCount: 0 },
  researchStatus: "unverified",
  healthStatus: "unknown",
  verificationStatus: "NotImplemented",
  lastVerifiedAt: null,
  backgroundAutomationStatus: "UNKNOWN",
  backgroundAutomationLastTestedAt: null,
  backgroundAutomationReason: null,
  transport: "manual",
  integrationMode: "Blocked",
  accountConnectionMode: "Blocked",
  blockingReason: definition.publishBlockReason,
  officialWebsite: "",
  developerPortal: null,
  credentialSchema: [],
  officialSources: []
});

export function operatorPlatformCatalog(platforms: readonly Platform[]): Platform[] {
  const current = new Map(platforms.map((platform) => [platform.platformKey, platform]));
  return PRODUCT_PLATFORM_POLICY.filter((definition) => definition.visibleInOperatorUi).map((definition) => {
    const existing = current.get(definition.platformKey);
    return existing ? { ...existing, displayName: definition.displayName } : missingPlatform(definition);
  });
}

export function operatorPublishBlockReason(platformKey: string, platform?: Platform | null): string | null {
  const definition = byKey.get(platformKey);
  if (!definition?.publishSelectorVisible) return "平台不在普通运营产品名单内";
  if (!definition.ordinaryPublishEnabled) return definition.publishBlockReason;
  if (!platform?.enabled || !platform.capabilities.article) return "当前主线没有可用的文章发布能力";
  return null;
}

export function safeOperatorSelection(platformKey: string | null | undefined, platforms: readonly Platform[]): string | null {
  if (!platformKey) return null;
  const platform = platforms.find((item) => item.platformKey === platformKey);
  return operatorPublishBlockReason(platformKey, platform) === null ? platformKey : null;
}

export interface OperatorStatisticsRow {
  platformKey: string;
  displayName: string;
  statusLabel: string;
  publishedCount: number;
}

export function operatorStatisticsRows(jobs: readonly Pick<PublishJob, "platformKey" | "status">[]): OperatorStatisticsRow[] {
  return PRODUCT_PLATFORM_POLICY.filter((definition) => definition.statisticsVisible).map((definition) => ({
    platformKey: definition.platformKey,
    displayName: definition.displayName,
    statusLabel: definition.statusLabel,
    publishedCount: jobs.filter((job) => job.platformKey === definition.platformKey && ["Published", "Success"].includes(job.status)).length
  }));
}
