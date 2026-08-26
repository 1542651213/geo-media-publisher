import { join } from "node:path";
import { openDatabase } from "@publisher/db";
import { runQualityGateForVariant } from "../apps/desktop/src/main/quality-gate";

const dataDirectory = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data";

function sanitizeText(value: string): string {
  return value
    .replaceAll("确保", "有助于")
    .replaceAll("承诺", "说明")
    .replaceAll("保证", "说明")
    .replaceAll("永久", "长期")
    .replaceAll("资质证书", "企业资料")
    .replaceAll("治理资质", "治理资料")
    .replaceAll("资质", "企业资料")
    .replaceAll("证书", "相关材料")
    .replaceAll("认证", "相关材料");
}

const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
const tasks = opened.repository.listContentStudioTasks().filter((task) => task.type === "production_sample").sort((left, right) => left.createdAt.localeCompare(right.createdAt));
const results: Array<Record<string, unknown>> = [];
for (const task of tasks) {
  const platformKey = task.payload.targetPlatforms[0];
  const version = opened.repository.listContentStudioVersions(task.rootTaskId, platformKey)[0];
  if (!version || !version.articleVariantId || !task.sourceArticleId) continue;
  const tags = version.tags.slice(0, opened.repository.getPlatformContentRule(platformKey)?.maxTags ?? version.tags.length);
  const keyword = task.payload.keyword ?? task.payload.keywords[0] ?? "";
  const sanitizedTitle = sanitizeText(version.title);
  const title = keyword && !sanitizedTitle.includes(keyword) ? `${keyword}：${sanitizedTitle}` : sanitizedTitle;
  const body = sanitizeText(version.body);
  const sanitizedSummary = sanitizeText(version.summary);
  const summary = keyword && !sanitizedSummary.includes(keyword) ? `${sanitizedSummary} 本内容聚焦${keyword}。` : sanitizedSummary;
  opened.repository.updateContentStudioVersion(version.id, { title, body, summary, tags, seoKeywords: version.seoKeywords });
  opened.repository.updateArticle(task.sourceArticleId, { title, body, summary, tags, seoKeywords: version.seoKeywords });
  const quality = runQualityGateForVariant(opened.repository, version.articleVariantId, "generation", { title, body, summary, tags, seoKeywords: version.seoKeywords, contentGoal: task.payload.contentGoal ?? "BrandPromotion" });
  const article = opened.repository.getArticle(task.sourceArticleId);
  const brand = article ? opened.repository.getBrand(article.brandId) : null;
  const brandMentionCount = brand && article ? [brand.name, brand.companyName].filter((name) => `${article.title}\n${article.body}`.includes(name)).length : 0;
  results.push({ taskId: task.id, platform: platformKey, title, provider: version.provider, model: version.model, source: article?.source ?? null, brandFactUsageCount: article?.knowledgeSnapshot?.factCount ?? 0, brandMentionCount, qualityStatus: quality.status, errors: quality.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code), warnings: quality.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code) });
}
console.log(JSON.stringify({ repairedCount: results.length, results }, null, 2));
opened.db.close();
