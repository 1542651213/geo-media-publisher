import type { AppRepository, ContentQualityReviewView } from "@publisher/db";
import { evaluateContentQuality, type ContentQualityContentInput, type ContentQualityContentType, type ContentQualityTrigger } from "@publisher/domain";

const provider = "quality-rule-engine";
const model = "v0.9-deterministic";

function similarTexts(repository: AppRepository, brandId: string, contentId: string, excludedArticleId?: string): string[] {
  const articles = repository.listArticles({ brandId });
  const articleTexts = articles.filter((article) => article.id !== contentId && article.id !== excludedArticleId).map((article) => article.body);
  const variantTexts = articles.filter((article) => article.id !== excludedArticleId).flatMap((article) => repository.listArticleVariants(article.id).filter((variant) => variant.id !== contentId).map((variant) => `${variant.title}\n${variant.body}`));
  return [...articleTexts, ...variantTexts].slice(0, 400);
}

export function runQualityGateForArticle(repository: AppRepository, articleId: string, trigger: ContentQualityTrigger = "generation"): ContentQualityReviewView {
  const article = repository.getArticle(articleId);
  if (!article) throw new Error("Article not found for Quality Gate");
  const brand = repository.getBrand(article.brandId);
  if (!brand) throw new Error("Brand not found for Quality Gate");
  const content: ContentQualityContentInput = { title: article.title, body: article.body, summary: article.summary, tags: article.tags, seoKeywords: article.seoKeywords, contentGoal: article.contentGoal ?? undefined, contentIntent: article.contentIntent ?? undefined, searchIntent: article.searchIntent ?? undefined, knowledgeSnapshot: article.knowledgeSnapshot };
  const result = evaluateContentQuality({ content, contentGoal: article.contentGoal ?? undefined, contentIntent: article.contentIntent ?? undefined, searchIntent: article.searchIntent ?? undefined, knowledgeSnapshot: article.knowledgeSnapshot, brand, city: article.city, keyword: article.keyword, knownCities: brand.serviceRegions, similarTexts: similarTexts(repository, article.brandId, article.id) });
  return repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: article.brandId, platformKey: null, contentHash: article.contentHash, trigger, provider, model, result, snapshot: { ...content } });
}

export function runQualityGateForVariant(repository: AppRepository, variantId: string, trigger: ContentQualityTrigger = "generation", contentOverride?: ContentQualityContentInput): ContentQualityReviewView {
  const variant = repository.getArticleVariant(variantId);
  if (!variant) throw new Error("Article variant not found for Quality Gate");
  const article = repository.getArticle(variant.articleId);
  if (!article) throw new Error("Source article not found for Quality Gate");
  const brand = repository.getBrand(article.brandId);
  if (!brand) throw new Error("Brand not found for Quality Gate");
  const content: ContentQualityContentInput = contentOverride ?? { title: variant.title, body: variant.body, summary: variant.summary };
  const result = evaluateContentQuality({ content, contentGoal: content.contentGoal, contentIntent: content.contentIntent, searchIntent: content.searchIntent, knowledgeSnapshot: content.knowledgeSnapshot, brand, city: article.city, keyword: article.keyword, knownCities: brand.serviceRegions, platformKey: variant.platformKey, platformProfile: repository.getPlatformProfile(variant.platformKey), platformRules: repository.getPlatformContentRule(variant.platformKey), similarTexts: similarTexts(repository, article.brandId, variant.id, article.id) });
  return repository.saveContentQualityReview({ contentType: "article_variant", contentId: variant.id, brandId: article.brandId, platformKey: variant.platformKey, contentHash: variant.contentHash, trigger, provider, model, result, snapshot: { ...content } });
}

export function runQualityGate(repository: AppRepository, contentType: ContentQualityContentType, contentId: string, trigger: ContentQualityTrigger = "manual_recheck"): ContentQualityReviewView {
  return contentType === "article" ? runQualityGateForArticle(repository, contentId, trigger) : runQualityGateForVariant(repository, contentId, trigger);
}
