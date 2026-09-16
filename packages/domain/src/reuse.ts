import type { Article, PublishRecord, ReusePolicy } from "./types";

export interface ReuseContext {
  article: Article;
  platformKey: string;
  accountId: string;
  records: PublishRecord[];
}

export function canReuseArticle(context: ReuseContext): boolean {
  const records = context.records.filter((record) => record.success && record.dryRun !== true && record.status !== "DryRun");
  switch (context.article.reusePolicy) {
    case "once":
      return records.length === 0;
    case "same_platform":
      return records.every((record) => record.platformKey !== context.platformKey);
    case "same_platform_different_account":
      return records.every((record) => record.platformKey !== context.platformKey || record.accountId !== context.accountId);
    case "always":
    case "rewrite":
      return true;
  }
}

export function normalizeReusePolicy(value: string): ReusePolicy {
  if (value === "same_platform" || value === "same_platform_different_account" || value === "always" || value === "rewrite") {
    return value;
  }
  return "once";
}
