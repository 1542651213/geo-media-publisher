import { normalizeContentReviewMode, type Account, type Article, type ContentReviewMode, type ImageAsset, type Platform, type PublishJob } from "@publisher/domain";
import type { AccountManagementRow } from "../shared/api";

export interface AccountCenterDataLoaders {
  overview: () => Promise<AccountManagementRow[]>;
  platforms: () => Promise<Platform[]>;
  settings: () => Promise<Record<string, unknown>>;
}

export interface AccountCenterData {
  overview: AccountManagementRow[];
  platforms: Platform[];
  favoritePlatformKeys: string[];
  errors: Array<keyof AccountCenterDataLoaders>;
}

export async function loadAccountCenterData(loaders: AccountCenterDataLoaders): Promise<AccountCenterData> {
  const keys: Array<keyof AccountCenterDataLoaders> = ["overview", "platforms", "settings"];
  const results = await Promise.allSettled([
    Promise.resolve().then(() => loaders.overview()),
    Promise.resolve().then(() => loaders.platforms()),
    Promise.resolve().then(() => loaders.settings())
  ]);
  const [overviewResult, platformsResult, settingsResult] = results;
  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : {};
  return {
    overview: overviewResult.status === "fulfilled" ? overviewResult.value : [],
    platforms: platformsResult.status === "fulfilled" ? platformsResult.value.filter((platform) => platform.platformKey !== "test") : [],
    favoritePlatformKeys: String(settings.favoritePlatformKeys ?? "").split(",").filter(Boolean),
    errors: results.flatMap((result, index) => result.status === "rejected" ? [keys[index]] : [])
  };
}

export type V11NavigationTarget =
  | "dashboard" | "production" | "articles" | "images" | "accounts" | "publishing" | "statistics" | "advanced"
  | "studio" | "quality" | "quality-rules" | "batch" | "keywords" | "ai-tasks" | "assets" | "images-advanced"
  | "brand" | "knowledge" | "platforms" | "self-test" | "plans" | "queue" | "logs" | "backups" | "settings" | "placeholder"
  | "preferences";

export const normalNavigation: Array<{ route: V11NavigationTarget; label: string; icon: string }> = [
  { route: "dashboard", label: "首页", icon: "⌂" },
  { route: "production", label: "内容生产", icon: "✦" },
  { route: "articles", label: "文章库", icon: "▤" },
  { route: "images", label: "图片库", icon: "▨" },
  { route: "accounts", label: "账号中心", icon: "◎" },
  { route: "publishing", label: "发布中心", icon: "↗" },
  { route: "statistics", label: "数据统计", icon: "▥" }
];

export const platformLabel = (key: string): string => ({
  zhihu: "知乎",
  weibo: "微博",
  toutiao: "头条",
  douyin: "抖音",
  wechat_official: "微信公众号",
  baijiahao: "百家号",
  bilibili: "B站",
  lieju: "列举网",
  cnblogs: "博客园"
}[key] ?? key);

export const articleReviewLabel = (status?: string | null): string => ({
  Draft: "草稿",
  AI_Checked: "待审核",
  Needs_Review: "需修改",
  Approved: "已通过",
  Rejected: "已驳回"
}[status ?? "Draft"] ?? "待审核");

export const articleReviewTone = (status?: string | null): string => ({
  Approved: "success",
  Rejected: "danger",
  Needs_Review: "warning",
  AI_Checked: "purple",
  Draft: "muted"
}[status ?? "Draft"] ?? "muted");

export const publishStatusLabel = (status: PublishJob["status"]): string => {
  if (["Pending", "Scheduled", "Retry"].includes(status)) return "待发布";
  if (["AwaitingConfirmation", "ReadyToSubmit"].includes(status)) return "等待确认";
  if (["Preparing", "Running", "Submitting", "Submitted", "Publishing"].includes(status)) return "发布中";
  if (["Published", "Success"].includes(status)) return "已发布";
  if (status === "DryRunPassed") return "等待确认";
  return "需要处理";
};

export const publishStatusTone = (status: PublishJob["status"]): string => {
  const label = publishStatusLabel(status);
  return label === "已发布" ? "success" : label === "需要处理" ? "warning" : label === "发布中" ? "purple" : "muted";
};

export type AccountRuntimeView = Pick<Account, "enabled" | "loginStatus" | "platformKey"> & { accountStatus?: string; runtimeAuthState?: string | null };

export const accountStatusLabel = (account: Pick<Account, "loginStatus"> & { accountStatus?: string }): string => {
  if (account.accountStatus === "Unverified") return "待验证";
  if (account.loginStatus === "logged_in" || account.accountStatus === "Connected") return "已登录";
  if (account.loginStatus === "needs_user_action" || account.accountStatus === "Connecting") return "需要完成验证";
  if (account.loginStatus === "expired" || account.accountStatus === "Expired" || account.accountStatus === "NeedsLogin") return "需要重新登录";
  return "未登录";
};

export const isOnlineAccount = (account: AccountRuntimeView): boolean =>
  account.enabled
  && (account.platformKey !== "xiaohongshu" || account.runtimeAuthState === "AUTHENTICATED")
  && (account.loginStatus === "logged_in" || account.accountStatus === "Connected");

export function connectedAccountsForPlatform<T extends AccountRuntimeView>(accounts: T[], platformKey: string): T[] {
  return accounts.filter((account) => account.platformKey === platformKey && isOnlineAccount(account));
}

export type AccountConnectionIntent = "connect" | "add" | "relogin";

export function accountConnectionTarget(rows: AccountManagementRow[], intent: AccountConnectionIntent): { accountId: string | null; createAccount: boolean } {
  if (intent === "add") return { accountId: null, createAccount: true };
  const incomplete = rows.filter((row) => row.accountStatus !== "Connected");
  if (incomplete.length === 1) return { accountId: incomplete[0].account.id, createAccount: false };
  return { accountId: null, createAccount: rows.length === 0 && intent === "connect" };
}

export function platformHasConnectedAccount(rows: AccountManagementRow[]): boolean {
  return rows.some((row) => row.accountStatus === "Connected");
}

export const contentReviewModeLabel = (mode: ContentReviewMode): string => ({ Off: "关闭审核", WarningOnly: "仅提醒", Strict: "严格审核" })[mode];

export const articleListStatusLabel = (article: Pick<Article, "status" | "publishCount">, qualityStatus: string | null | undefined, rawMode: unknown): "可发布" | "有提醒" | "已发布" | "需要处理" => {
  if (article.status === "published" || article.publishCount > 0) return "已发布";
  const mode = normalizeContentReviewMode(rawMode);
  if (mode === "Strict") return qualityStatus === "Approved" ? "可发布" : "需要处理";
  if (mode === "WarningOnly" && (qualityStatus === "Needs_Review" || qualityStatus === "Rejected")) return "有提醒";
  return "可发布";
};

export const canPublishWithReviewMode = (qualityStatus: string | null | undefined, rawMode: unknown): boolean =>
  normalizeContentReviewMode(rawMode) !== "Strict" || qualityStatus === "Approved";

export const ACCOUNT_CENTER_PRIORITY = {
  CONNECTED: 1,
  CONNECTABLE: 2,
  CONFIG_REQUIRED: 3,
  ASSISTED_MANUAL: 4,
  DEVELOPING: 5,
  BLOCKED_NOT_IMPLEMENTED: 6
} as const;

export type AccountCenterPriority = keyof typeof ACCOUNT_CENTER_PRIORITY;

export const accountCenterPriority = (platform: Platform, accounts: Account[]): AccountCenterPriority => {
  if (connectedAccountsForPlatform(accounts, platform.platformKey).length > 0) return "CONNECTED";
  if (platform.verificationStatus === "Blocked" || platform.verificationStatus === "NotImplemented" || platform.integrationMode === "Blocked") return "BLOCKED_NOT_IMPLEMENTED";
  if (["Developing", "Planned", "Researched", "NotResearched"].includes(platform.verificationStatus)) return "DEVELOPING";
  if (platform.integrationMode === "BrowserAutomation") return "CONNECTABLE";
  if (platform.integrationMode === "API" || platform.integrationMode === "OAuth") return "CONFIG_REQUIRED";
  if (platform.integrationMode === "SemiAuto" || platform.integrationMode === "Manual" || platform.verificationStatus === "ManualOnly") return "ASSISTED_MANUAL";
  return "BLOCKED_NOT_IMPLEMENTED";
};

const recentAccountUse = (account: Account): number => {
  const values = [account.lastUsedAt, account.lastPublishAt, account.lastVerifiedAt, account.lastLoginCheck]
    .map((value) => value ? Date.parse(value) : 0)
    .filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : 0;
};

export const orderPlatformCatalog = (platforms: Platform[], favoritePlatformKeys: string[], accounts: Account[] = []): Platform[] => {
  const favorites = new Set(favoritePlatformKeys);
  const recentByPlatform = new Map<string, number>();
  for (const account of accounts) recentByPlatform.set(account.platformKey, Math.max(recentByPlatform.get(account.platformKey) ?? 0, recentAccountUse(account)));
  return [...platforms].sort((left, right) => {
    const priority = ACCOUNT_CENTER_PRIORITY[accountCenterPriority(left, accounts)] - ACCOUNT_CENTER_PRIORITY[accountCenterPriority(right, accounts)];
    if (priority !== 0) return priority;
    const favorite = Number(favorites.has(right.platformKey)) - Number(favorites.has(left.platformKey));
    if (favorite !== 0) return favorite;
    const recent = (recentByPlatform.get(right.platformKey) ?? 0) - (recentByPlatform.get(left.platformKey) ?? 0);
    if (recent !== 0) return recent;
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });
};

export const searchOrderedPlatforms = (platforms: Platform[], query: string): Platform[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return platforms;
  return platforms.filter((platform) => platform.displayName.toLocaleLowerCase().includes(normalized) || platform.platformKey.toLocaleLowerCase().includes(normalized));
};

export const platformAvailability = (platform: Platform): "available" | "manual" | "blocked" | "developing" => {
  if (platform.verificationStatus === "Blocked" || platform.integrationMode === "Blocked") return "blocked";
  if (["Developing", "NotImplemented", "Planned", "Researched", "NotResearched"].includes(platform.verificationStatus)) return "developing";
  if (platform.integrationMode === "Manual" || platform.verificationStatus === "ManualOnly") return "manual";
  return "available";
};

export const platformCapabilityText = (platform: Platform): string => {
  if (platformAvailability(platform) === "blocked") return "当前平台暂不开放连接";
  if (platformAvailability(platform) === "developing") return "接入能力正在准备中";
  const capabilities = [platform.capabilities.article ? "文章" : "", platform.capabilities.imagePost ? "图文" : "", platform.capabilities.video ? "视频" : ""].filter(Boolean);
  return capabilities.length ? `支持${capabilities.join("、")}内容` : "可打开官方平台处理内容";
};

export const platformConnectionModeLabel = (platform: Platform): string => {
  const mode = platform.accountConnectionMode ?? platform.integrationMode;
  if (mode === "BrowserAutomation" || platform.transport === "browser") return "浏览器自动化";
  if (mode === "SemiAuto" || platform.transport === "semi_auto") return "半自动";
  if (mode === "OAuth" || platform.authStrategy === "OAuth2" || platform.authStrategy === "OAuth2PKCE") return "OAuth";
  if (mode === "API" || platform.transport === "official_api" || platform.transport === "official_sdk") return "官方 API";
  if (mode === "Blocked") return "不可接入";
  return "人工";
};

export const accountCapabilityText = (platform: Platform, publishVerification: string): string => {
  if (publishVerification === "PublishPassed") return "已连接 · 发布能力已验证";
  if (platform.integrationMode === "BrowserAutomation") {
    if (platform.backgroundAutomationStatus === "PASSED") return "已连接 · 后台发布已验证";
    if (platform.backgroundAutomationStatus === "REQUIRES_VISIBLE_BROWSER") return "已连接 · 可见发布可用";
    return "已连接 · 发布能力待测试；验证码需人工处理";
  }
  return "已连接 · 发布能力待测试";
};

export const imageMatchReason = (article: Pick<Article, "business" | "city" | "keyword" | "tags" | "seoKeywords">, image: ImageAsset | null): string => {
  if (!image) return "暂无匹配图片";
  const equals = (left: string, right: string): boolean => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
  const business = article.business && image.business.some((item) => equals(item, article.business ?? "")) ? article.business : "";
  const city = article.city && image.city.some((item) => equals(item, article.city)) ? article.city : "";
  if (business && city) return `${business} / ${city}`;
  if (business) return business;
  if (city) return city;
  const targets = [article.keyword, ...article.tags, ...article.seoKeywords].filter(Boolean);
  const usage = [...image.usage, ...image.tags].find((item) => targets.some((target) => equals(item, target)));
  return usage || (image.universal ? "通用图片" : "相关企业图片");
};
