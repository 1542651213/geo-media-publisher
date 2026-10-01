import { CONTENT_STUDIO_PLATFORMS, platformContentPolicy, type Account, type Platform, type PublishJob } from "@publisher/domain";

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
  { ...define("website", "官网", 3, "PRODUCT_E2E_PUBLISHED", "OfficialAPI 可发布", "康一 ARTICLE / CASE 支持封面、正文图片与图库；确认后提交，按原任务查询结果。", ""), ordinaryPublishEnabled: true },
  { ...define("toutiao", "今日头条", 4, "PRODUCT_E2E_PUBLISHED", "图文可发布", "单账号、纯文本正文、单封面；准备后确认一次，按原任务查询结果。", ""), ordinaryPublishEnabled: true },
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

export type ProductHealthStatus = "可发布" | "需要登录" | "凭据失效" | "需要 Owner 操作" | "待验收" | "只读" | "暂未开发" | "连接异常" | "正在验证账号" | "已连接" | "登录已失效，请重新登录" | "凭据已失效，请更新凭据" | "暂时无法验证连接" | "当前登录账号与绑定账号不一致" | "尚未验证" | "已停用";
export function sessionAccountHealth(platformKey: string, state: string): Pick<ProductAccountHealth, "status" | "ownerNextAction" | "identityEvidence"> {
  const statuses: Record<string, ProductHealthStatus> = { CHECKING: "正在验证账号", AUTHENTICATED: "已连接", CONNECTED: "已连接", NEEDS_LOGIN: "登录已失效，请重新登录", CREDENTIAL_INVALID: "凭据已失效，请更新凭据", NETWORK_UNAVAILABLE: "暂时无法验证连接", IDENTITY_MISMATCH: "当前登录账号与绑定账号不一致", UNVERIFIED: "尚未验证", DISABLED: "已停用" };
  const connected = ["AUTHENTICATED", "CONNECTED"].includes(state);
  return { status: statuses[state] ?? "尚未验证", identityEvidence: connected ? "REMOTE_VERIFIED" : "UNVERIFIED", ownerNextAction: connected ? productPlatform(platformKey)?.ordinaryPublishEnabled ? "发布前会再次核验真实身份和审核内容" : "账号已连接；仍需单独授权真实验收后开放正式发布" : state === "NETWORK_UNAVAILABLE" ? "检查网络后重新验证；无需因此重复登录" : state === "CREDENTIAL_INVALID" ? "由 Owner 更新凭据并重新验证" : state === "IDENTITY_MISMATCH" ? "由 Owner 核对绑定身份和当前登录账号" : state === "CHECKING" ? "正在后台只读验证，请稍候" : "由 Owner 登录或确认账号企业归属后重新验证" };
}
export interface ProductAccountHealth {
  platformKey: string; accountId: string | null; accountName: string; companyName: string; connectionMode: string;
  status: ProductHealthStatus; lastVerifiedAt: string | null; ownerNextAction: string; identityEvidence: "REMOTE_VERIFIED" | "UNVERIFIED";
}
export function productAccountHealth(platformKey: string, account?: Account | null, identityVerified = false): ProductAccountHealth {
  const definition = productPlatform(platformKey);
  let status: ProductHealthStatus = "待验收", ownerNextAction = "完成普通产品链路验收后再开放发布";
  if (platformKey === "netease_media") { status = "暂未开发"; ownerNextAction = "等待平台独立接入"; }
  else if (platformKey === "cnblogs" && (!account || account.loginStatus === "expired")) { status = "凭据失效"; ownerNextAction = "更新博客园访问令牌 PAT，并重新验证身份"; }
  else if (platformKey === "weibo" && !identityVerified) { status = "需要登录"; ownerNextAction = "由 Owner 登录微博官方后台"; }
  else if (platformKey === "sohu_media" && !identityVerified) { status = "需要登录"; ownerNextAction = "由 Owner 登录搜狐 Creator 后台"; }
  else if (platformKey === "lieju") { status = "需要 Owner 操作"; ownerNextAction = "由 Owner 完成平台正常验证"; }
  else if (account?.loginStatus === "expired") { status = "凭据失效"; ownerNextAction = "重新登录或更新授权"; }
  else if (account?.loginStatus === "unknown") { status = "连接异常"; ownerNextAction = "检查连接后重新验证真实账号身份"; }
  else if (definition?.ordinaryPublishEnabled && !identityVerified) { status = "需要登录"; ownerNextAction = "核验平台真实身份；本地登录标记不能代替远端确认"; }
  else if (definition?.ordinaryPublishEnabled && identityVerified) { status = account?.enabled ? "可发布" : "只读"; ownerNextAction = account?.enabled ? "发布前系统会再次核验身份和内容" : "账号当前未启用"; }
  return { platformKey, accountId: account?.id ?? null, accountName: account?.accountName || account?.accountAlias || account?.name || "尚未连接账号", companyName: "发布时由文章所属企业确定", connectionMode: account?.connectionMode ?? "尚未连接", status, lastVerifiedAt: account?.lastVerifiedAt ?? null, ownerNextAction, identityEvidence: identityVerified ? "REMOTE_VERIFIED" : "UNVERIFIED" };
}
export interface ProductPreflightInput {
  platformKey: string; companyId: string; companyName: string;
  article: { id: string; brandId: string; title: string; body: string } | null;
  account: Pick<Account, "id" | "platformKey" | "enabled" | "archivedAt"> | null;
  identityVerified: boolean; images: Array<{ brandId: string | null; available: boolean }>;
  contentType: string; publishMode: string;
  reviewApproved?: boolean;
}
export interface ProductPreflightResult {
  authority: "Main"; allowed: boolean; blockers: string[];
  items: Array<{ label: string; value: string; passed: boolean }>;
}
export function evaluateProductPreflight(input: ProductPreflightInput): ProductPreflightResult {
  const policy = platformContentPolicy(input.platformKey), definition = productPlatform(input.platformKey), blockers: string[] = [];
  const article = input.article, account = input.account;
  if (input.reviewApproved !== true) blockers.push("内容尚未人工审核通过，请先进入内容审核");
  if (!definition?.ordinaryPublishEnabled) blockers.push(definition?.publishBlockReason || "平台暂未开放正式发布");
  if (!article || article.brandId !== input.companyId || !input.companyId) blockers.push("文章与企业不匹配");
  if (!article?.title.trim()) blockers.push("请填写标题");
  if (!article?.body.trim()) blockers.push("请填写正文");
  if (article && policy.maxTitleLength !== null && article.title.length > policy.maxTitleLength) blockers.push(`标题最多 ${policy.maxTitleLength} 个 UTF-16 字符，请先修改标题`);
  if (!account || account.platformKey !== input.platformKey || !account.enabled || account.archivedAt) blockers.push("账号不可用或与平台不匹配");
  if (!input.identityVerified) blockers.push("远端身份尚未确认，请先登录或验证连接");
  if (input.images.some(image => !image.available || image.brandId !== input.companyId)) blockers.push("图片不可用或与文章企业不匹配");
  if (policy.minImageCount !== null && input.images.length < policy.minImageCount || policy.maxImageCount !== null && input.images.length > policy.maxImageCount) blockers.push("图片数量不符合当前平台发布范围");
  if (policy.supportedContentTypes && !policy.supportedContentTypes.includes(input.contentType)) blockers.push("内容类型尚未开放");
  if (["douyin", "toutiao", "website"].includes(input.platformKey) && !["CONFIRM_BEFORE_PUBLISH", "PREPARE_ONLY"].includes(input.publishMode)) blockers.push("当前平台需要发布前确认");
  const items = [
    { label: "人工审核", value: input.reviewApproved === true ? "当前内容已审核" : "待审核", passed: input.reviewApproved === true },
    { label: "企业", value: input.companyName, passed: Boolean(article && article.brandId === input.companyId) },
    { label: "平台能力", value: definition?.displayName ?? "未知平台", passed: definition?.ordinaryPublishEnabled === true },
    { label: "账号健康", value: input.identityVerified ? "真实身份已核验" : "需要登录或核验", passed: input.identityVerified && Boolean(account?.enabled) },
    { label: "Article", value: article?.id ?? "未选择", passed: Boolean(article) },
    { label: "标题", value: article?.title ?? "", passed: Boolean(article?.title.trim()) && !(article && policy.maxTitleLength !== null && article.title.length > policy.maxTitleLength) },
    { label: "正文", value: `${article?.body.length ?? 0} 字符`, passed: Boolean(article?.body.trim()) },
    { label: "图片", value: `${input.images.length} 张`, passed: !blockers.some(reason => reason.startsWith("图片")) },
    { label: "内容类型", value: input.contentType, passed: !policy.supportedContentTypes || policy.supportedContentTypes.includes(input.contentType) },
    { label: "发布方式", value: input.publishMode === "PREPARE_ONLY" ? "只准备" : "发布前确认", passed: !blockers.some(reason => reason.includes("发布前确认")) }
  ];
  return { authority: "Main", allowed: blockers.length === 0, blockers, items };
}
export function productErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, "");
  if (/DOUYIN_BODY_SLATE_STRUCTURE_UNVERIFIED/u.test(message)) return "正文编辑器状态暂时无法确认，请不要重复发布。";
  if (/NeedsReconciliation|RESULT_UNKNOWN|TRANSPORT_UNKNOWN|SUBMISSION_UNKNOWN/iu.test(message)) return "远端结果暂时无法确认，请勿再次发布。";
  if (/cnblogs.*401|401.*cnblogs/iu.test(message)) return "博客园授权已失效，请更新访问令牌。";
  if (/DOUYIN_.*(?:IDENTITY|CREATOR|SESSION)/u.test(message)) return "抖音账号身份暂时无法确认，请先连接 Creator 会话。";
  if (/TOUTIAO_.*(?:IDENTITY|SESSION|ACCOUNT|LOGIN)/u.test(message)) return "头条账号连接需要核验，请先在账号中心恢复会话。";
  if (/^[A-Z][A-Z0-9_]{5,}/u.test(message)) return "当前操作条件尚未满足，请查看详情；发布结果不确定时请勿重复提交。";
  return message;
}
export function buildProductDiagnosticBundle(input: { version: string; migrationCount: number; providers: Array<{ provider: string; configured: boolean; verificationStatus: string }>; generationStatuses: string[]; jobs: number }) {
  const statuses: Record<string, number> = {};
  for (const status of input.generationStatuses) statuses[status] = (statuses[status] ?? 0) + 1;
  return { schemaVersion: 1, createdAt: new Date().toISOString(), applicationVersion: input.version, migrationCount: input.migrationCount,
    platforms: PRODUCT_PLATFORM_POLICY.map(item => ({ platform: item.platformKey, ordinaryPublishEnabled: item.ordinaryPublishEnabled, batchPublishEnabled: item.batchPublishEnabled })),
    providers: input.providers.map(item => ({ provider: item.provider, configured: item.configured, verificationStatus: item.verificationStatus })), generationStatuses: statuses, jobCount: input.jobs,
    exclusions: ["credentials", "prompts", "responses", "article bodies", "company/account identity", "private paths", "raw logs"] };
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
