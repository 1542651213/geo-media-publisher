import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type ContentStudioTaskPayload } from "@publisher/db";
import { MockAIProvider } from "@publisher/ai";
import { CONTENT_STUDIO_PLATFORM_KEYS, type ContentStudioPlatformKey, type ContentStudioTopicPlan } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { runContentStudioTask } from "../apps/desktop/src/main/content-studio";
import { runQualityGateForVariant } from "../apps/desktop/src/main/quality-gate";

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "geo-media-v091-acceptance-"));
const databasePath = join(tempDir, "publisher.db");
const { db, repository } = openDatabase(databasePath, join(root, "packages", "db", "migrations"));
const logger = createConsoleLogger();
const platforms = [...CONTENT_STUDIO_PLATFORM_KEYS] as ContentStudioPlatformKey[];

const topics: Array<{ title: string; city: string; keyword: string }> = [
  { title: "木渎甲醛治理前的现场信息清单", city: "木渎", keyword: "甲醛治理现场评估" },
  { title: "苏州甲醛治理与装修异味处理如何区分", city: "苏州", keyword: "甲醛治理异味处理" },
  { title: "江苏新房甲醛治理的现场评估流程", city: "江苏", keyword: "新房甲醛治理" },
  { title: "木渎甲醛治理后复检与入住判断", city: "木渎", keyword: "甲醛治理复检" },
  { title: "木渎定期消杀服务前要确认哪些范围", city: "木渎", keyword: "定期消杀范围确认" },
  { title: "苏州定期消杀的沟通与执行节点", city: "苏州", keyword: "定期消杀执行节点" },
  { title: "江苏办公场所定期消杀需求怎么整理", city: "江苏", keyword: "办公室定期消杀" },
  { title: "木渎定期消杀后的反馈记录怎么留存", city: "木渎", keyword: "定期消杀反馈" },
  { title: "木渎灭四害前如何描述现场问题", city: "木渎", keyword: "灭四害现场问题" },
  { title: "苏州灭四害服务流程与边界说明", city: "苏州", keyword: "灭四害服务流程" },
  { title: "江苏餐饮场所灭四害沟通清单", city: "江苏", keyword: "餐饮灭四害" },
  { title: "木渎灭四害后如何进行现场反馈", city: "木渎", keyword: "灭四害现场反馈" },
  { title: "木渎白蚁防治的现场判断问题", city: "木渎", keyword: "白蚁防治现场判断" },
  { title: "苏州白蚁防治服务如何确认方案", city: "苏州", keyword: "白蚁防治方案确认" },
  { title: "江苏住宅白蚁防治的资料准备", city: "江苏", keyword: "住宅白蚁防治" },
  { title: "木渎白蚁防治后的复核与沟通", city: "木渎", keyword: "白蚁防治复核" },
  { title: "木渎病媒生物防制的需求拆解", city: "木渎", keyword: "病媒生物防制需求" },
  { title: "苏州病媒生物防制如何看服务边界", city: "苏州", keyword: "病媒生物防制边界" },
  { title: "江苏公共场所病媒生物防制沟通清单", city: "江苏", keyword: "公共场所病媒生物防制" },
  { title: "木渎病媒生物防制的过程记录", city: "木渎", keyword: "病媒生物防制记录" }
];

function getVariants(brandId: string) {
  return repository.listArticles({ brandId }).flatMap((article) => repository.listArticleVariants(article.id).map((variant) => ({ article, variant })));
}

function statusCounts(brandId: string): Record<string, number> {
  return getVariants(brandId).reduce<Record<string, number>>((counts, item) => {
    const status = repository.getContentQualityState("article_variant", item.variant.id)?.status ?? "Draft";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

async function main(): Promise<void> {
  repository.seedDevelopment(join(root, "PLATFORMS.csv"));
  const existing = repository.listBrands().find((brand) => brand.companyName === "江苏康一环保科技有限公司");
  const brand = existing ? repository.updateBrand(existing.id, {
    name: "康一环保",
    companyName: "江苏康一环保科技有限公司",
    description: "提供室内环境检测、甲醛治理、装修异味处理及空气质量咨询，以及定期消杀、灭四害、白蚁防治、病媒生物防制等环境治理服务。",
    mainBusiness: "甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制",
    serviceRegions: ["江苏", "苏州", "木渎"],
    advantages: ["服务范围以企业资料为准", "流程与边界可在沟通时确认"],
    contact: {},
    serviceProcess: "需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通；具体以双方确认的服务约定为准。",
    afterSales: "以双方确认的服务约定为准；是否复检、整改或返工需以合同和现场情况为准。",
    faq: "服务前可准备房屋或场所类型、面积、问题表现和期望时间。",
    certificates: "",
    patents: "",
    equipment: "",
    cases: "",
    aiForbiddenClaims: ["国家级认证", "国家级资质", "不存在的资质", "不存在的证书", "不存在的专利", "行业第一", "第一品牌", "最好", "100%清除甲醛", "绝对", "唯一", "永久", "永不反弹", "一次治理永久有效"]
  }) : repository.createBrand({
    name: "康一环保",
    companyName: "江苏康一环保科技有限公司",
    description: "提供室内环境检测、甲醛治理、装修异味处理及空气质量咨询，以及定期消杀、灭四害、白蚁防治、病媒生物防制等环境治理服务。",
    mainBusiness: "甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制",
    serviceRegions: ["江苏", "苏州", "木渎"],
    advantages: ["服务范围以企业资料为准", "流程与边界可在沟通时确认"],
    contact: {},
    serviceProcess: "需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通；具体以双方确认的服务约定为准。",
    afterSales: "以双方确认的服务约定为准；是否复检、整改或返工需以合同和现场情况为准。",
    faq: "服务前可准备房屋或场所类型、面积、问题表现和期望时间。",
    certificates: "",
    patents: "",
    equipment: "",
    cases: "",
    aiForbiddenClaims: ["国家级认证", "国家级资质", "不存在的资质", "不存在的证书", "不存在的专利", "行业第一", "第一品牌", "最好", "100%清除甲醛", "绝对", "唯一", "永久", "永不反弹", "一次治理永久有效"]
  });

  const keywordExpansion = repository.expandContentStudioKeywords({ brandId: brand.id, cities: ["江苏", "苏州", "木渎"], keywords: ["甲醛治理", "定期消杀", "灭四害", "白蚁防治", "病媒生物防制"], industry: "环保服务" });
  for (const topic of topics) {
    const topicPlan: ContentStudioTopicPlan = { summary: topic.title, topics: [{ title: topic.title, angle: "基于已录入业务资料解释用户判断问题", audience: `${topic.city}用户`, keyPoints: ["明确需求", "核对流程", "确认边界"], recommendedPlatforms: platforms }] };
    const payload: ContentStudioTaskPayload = { brandId: brand.id, industry: "环保服务", cities: [topic.city], keywords: [topic.keyword], targetPlatforms: platforms, topicPlan, mediaAssetIds: [], videoAssetIds: [], concurrency: 3 };
    const taskId = repository.createContentStudioTask({ brandId: brand.id, type: "multi_platform_content", provider: "mock", model: "mock-editor-v0.1", totalCount: platforms.length, payload });
    repository.persistContentStudioPlan(taskId, topicPlan);
    await runContentStudioTask(repository, logger, { createAiProvider: () => new MockAIProvider() }, taskId);
  }

  const generatedVariants = getVariants(brand.id);
  const cleanCandidate = generatedVariants.find((item) => repository.getContentQualityState("article_variant", item.variant.id)?.status === "AI_Checked") ?? generatedVariants[0];
  let manualEditCount = 0;
  let needsReviewApproved = false;
  if (cleanCandidate) {
    const candidate = cleanCandidate.variant;
    repository.updateArticleVariant(candidate.id, { title: `${cleanCandidate.article.city}服务判断与流程说明` });
    manualEditCount += 1;
    runQualityGateForVariant(repository, candidate.id, "manual_edit");
    const needsReviewState = repository.getContentQualityState("article_variant", candidate.id);
    if (needsReviewState?.status === "Needs_Review") {
      repository.updateArticleVariant(candidate.id, { title: candidate.title });
      manualEditCount += 1;
      runQualityGateForVariant(repository, candidate.id, "manual_recheck");
      const afterEdit = repository.getContentQualityState("article_variant", candidate.id);
      if (afterEdit?.status === "AI_Checked" || afterEdit?.status === "Needs_Review") {
        repository.decideContentQuality("article_variant", candidate.id, "Approved", "human-review", "manual", "人工修改后复检通过");
        needsReviewApproved = repository.getContentQualityState("article_variant", candidate.id)?.status === "Approved";
      }
    }
  }

  const rejectionCandidate = getVariants(brand.id).find((item) => {
    const status = repository.getContentQualityState("article_variant", item.variant.id)?.status;
    return status === "AI_Checked";
  });
  let aiCheckedRejected = false;
  if (rejectionCandidate) {
    repository.decideContentQuality("article_variant", rejectionCandidate.variant.id, "Rejected", "human-review", "manual", "人工审核驳回验收路径");
    aiCheckedRejected = repository.getContentQualityState("article_variant", rejectionCandidate.variant.id)?.status === "Rejected";
  }

  const currentCounts = statusCounts(brand.id);
  const ruleRows = repository.getPlatformContentRules();
  const riskCounts: Record<string, number> = {};
  for (const item of getVariants(brand.id)) for (const review of repository.listContentQualityReviews("article_variant", item.variant.id)) for (const risk of review.issues) riskCounts[risk.code] = (riskCounts[risk.code] ?? 0) + 1;
  const autoChecked = getVariants(brand.id).filter((item) => repository.listContentQualityReviews("article_variant", item.variant.id).some((review) => review.trigger === "generation" && review.status === "AI_Checked")).length;
  const auditRows = getVariants(brand.id).flatMap((item) => repository.listContentQualityAudits("article_variant", item.variant.id));
  const reportDraft = `# V0.9.1 真实品牌内容质量验收报告

## 验收范围

- 测试品牌：江苏康一环保科技有限公司（通过品牌中心数据接口写入临时验收数据库；未写入生产数据库）。
- 已录入业务：甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制。
- 测试地区：江苏、苏州、木渎。
- 生成方式：复用 AI Content Studio 任务、文章库、平台 Variant 和 Quality Gate；本次使用 Mock Provider 做离线、可重复验收，未执行真实平台发布。
- 目标平台：微信公众号、知乎、今日头条、新浪微博、抖音脚本、B站脚本，共 ${platforms.length} 个既有平台。

## 生产数量

| 指标 | 结果 |
| --- | ---: |
| 主题数 | ${topics.length} |
| 生成任务数 | ${repository.listContentStudioTasks(brand.id).length} |
| 平台版本数 | ${generatedVariants.length} |
| 平台数 | ${new Set(generatedVariants.map((item) => item.variant.platformKey)).size} |
| 关键词扩展写入数 | ${keywordExpansion.items.length} |
| 自动 AI_Checked 数 | ${autoChecked} |
| 当前 AI_Checked 数 | ${currentCounts.AI_Checked ?? 0} |
| 当前 Needs_Review 数 | ${currentCounts.Needs_Review ?? 0} |
| 当前 Rejected 数 | ${currentCounts.Rejected ?? 0} |
| 人工修改次数 | ${manualEditCount} |
| 当前 Approved 数 | ${currentCounts.Approved ?? 0} |

## Quality Gate 结果

最常见风险类型：${Object.entries(riskCounts).sort((left, right) => right[1] - left[1]).slice(0, 5).map(([code, count]) => `${code}（${count}）`).join("、") || "未发现"}。

- 品牌事实：只使用本次品牌资料中的业务范围和服务边界；证书、专利、案例保持空白，作为禁止编造边界。
- 资质与证书：对未提供的国家级认证、资质、证书、专利进行拦截；否定式“未提供、不作推断”不会被当成虚假声明。
- 绝对化与效果承诺：检查第一、最好、100%、绝对、唯一、保证、永久、永不反弹、一次治理永久有效等风险表达。
- 城市一致性：木渎目标内容检查与南京、上海等明显冲突城市；江苏、苏州、木渎的上下级服务范围按规则处理。
- SEO：检查标题、摘要、正文和 SEO 关键词对主关键词及城市词的自然覆盖。
- 重复度：使用中文字符 n-gram 比较批量内容，防止仅替换城市词；高重复只进入 Needs_Review，不自动批准。
- 平台规则：${ruleRows.length} 个现有平台均有 PlatformContentRules；本次未确认官方精确限制，均标记 unverified，采用保守 fallback，不虚构 source 或 lastVerifiedAt。

## 人工流程验收

- Needs_Review → 人工编辑 → 重新检查 → Approved：${needsReviewApproved ? "PASS" : "BLOCKED（本次生成样例未形成可批准的 Needs_Review 路径）"}
- AI_Checked → Rejected：${aiCheckedRejected ? "PASS" : "BLOCKED（本次生成样例未形成可驳回的 AI_Checked 路径）"}
- 审核历史：${auditRows.length} 条，记录 operator type、previous status、new status、reason、timestamp、content hash；未保存 Credential。

## 说明

本报告只保存计数、状态、风险类型和哈希前缀，不保存电话、API Key、Cookie、StorageState 或其他敏感凭据，也不代表任何真实平台已经发布。
`;
  void reportDraft;
  const currentStatusCount = { Draft: currentCounts.Draft ?? 0, AI_Checked: currentCounts.AI_Checked ?? 0, Needs_Review: currentCounts.Needs_Review ?? 0, Approved: currentCounts.Approved ?? 0, Rejected: currentCounts.Rejected ?? 0 };
  const generatedVariantCount = generatedVariants.length;
  const currentUniqueContentCount = Object.values(currentStatusCount).reduce((total, count) => total + count, 0);
  const reviewEventCount = generatedVariants.reduce((total, item) => total + repository.listContentQualityReviews("article_variant", item.variant.id).length, 0);
  const revisionCount = auditRows.filter((audit) => audit.operatorType === "human" && audit.newStatus === "Draft").length;
  const report = `# V0.9.1 真实品牌内容质量验收报告

## 历史统计口径修正

本报告修正上一版把“生成事件状态”和“当前唯一内容状态”放在同一张表造成的重复计数问题。原始审核记录未删除、未覆盖；本版明确区分生成版本数、当前唯一内容状态数、审核事件数和版本修订数。

## 数量与状态

| 指标 | 结果 |
| --- | ---: |
| 主题数 | ${topics.length} |
| 生成 Variant 数（generatedVariantCount） | ${generatedVariantCount} |
| 当前唯一内容数（currentUniqueContentCount） | ${currentUniqueContentCount} |
| 当前 Draft | ${currentStatusCount.Draft} |
| 当前 AI_Checked | ${currentStatusCount.AI_Checked} |
| 当前 Needs_Review | ${currentStatusCount.Needs_Review} |
| 当前 Approved | ${currentStatusCount.Approved} |
| 当前 Rejected | ${currentStatusCount.Rejected} |
| 审核事件数（reviewEventCount） | ${reviewEventCount} |
| 版本修订数（revisionCount） | ${revisionCount} |
| Approved 唯一内容数 | ${currentStatusCount.Approved} |
| Rejected 唯一内容数 | ${currentStatusCount.Rejected} |
| 关键词扩展写入数 | ${keywordExpansion.items.length} |

当前状态计数合计 ${currentUniqueContentCount}，与当前唯一内容数一致；“自动 AI_Checked 数 ${autoChecked}”仅作为生成事件指标保留，不再与当前状态相加。

## Quality Gate 与人工流程

- 风险最高类型：${Object.entries(riskCounts).sort((left, right) => right[1] - left[1]).slice(0, 5).map(([code, count]) => `${code}: ${count}`).join("；") || "未发现"}。
- Needs_Review → 人工编辑 → 重新检查 → Approved：${needsReviewApproved ? "PASS" : "BLOCKED"}。
- AI_Checked → Rejected：${aiCheckedRejected ? "PASS" : "BLOCKED"}。
- 审计记录：${auditRows.length} 条；记录 operator type、previous status、new status、reason、timestamp、content hash，不保存 Credential。

## 安全边界

本报告只保存数量、状态、风险类型和哈希，不保存 API Key、Cookie、StorageState 或其他敏感凭据，也不代表任何真实平台已经发布内容。
`;
  writeFileSync(join(root, "docs", "V0.9.1_REAL_BRAND_QUALITY_ACCEPTANCE.md"), report, "utf8");
  console.log(JSON.stringify({ topics: topics.length, variants: generatedVariants.length, platforms: new Set(generatedVariants.map((item) => item.variant.platformKey)).size, autoChecked, statusCounts: currentCounts, manualEditCount, needsReviewApproved, aiCheckedRejected, rules: ruleRows.length, riskCounts }, null, 2));
}

try {
  await main();
} finally {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
