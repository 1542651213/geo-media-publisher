import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const SPRINT_ACCEPTANCE_MARKER = "r115-d-sprint-acceptance.json";
export interface SprintAcceptanceSelection {
  platformKey: "weibo" | "toutiao" | "sohu_media" | "cnblogs";
  accountId: string; articleId: string; imageAssetId: string | null;
  expectedRemoteId: string; contentHash: string; expiresAt: string;
}
interface SprintJob { id: string; platformKey: string; accountId: string; articleId: string; selectedImageAssetId?: string | null; }
interface SprintRepository {
  listAccounts(): Array<{ id: string; platformKey: string; platformAccountId?: string | null; externalAccountId?: string | null }>;
  getArticle(id: string): { contentHash: string } | null;
  getJob(id: string): SprintJob | null;
  listJobs(): SprintJob[];
  getSubmissionIntentByJob(id: string): { finalSubmitCount: number } | null;
}
export class SprintAcceptanceController {
  constructor(readonly grants: readonly SprintAcceptanceSelection[], private readonly repository: SprintRepository) {}
  availability(): SprintAcceptanceSelection[] { return this.grants.filter(grant => Date.parse(grant.expiresAt) > Date.now()).map(grant => ({ ...grant })); }
  private matches(job: Omit<SprintJob, "id">): boolean {
    const account = this.repository.listAccounts().find(item => item.id === job.accountId && item.platformKey === job.platformKey);
    const article = this.repository.getArticle(job.articleId);
    return Boolean(account?.externalAccountId && article && this.grants.some(grant => sprintSelectionMatches(grant, {
      platformKey: job.platformKey as SprintAcceptanceSelection["platformKey"], accountId: job.accountId,
      articleId: job.articleId, imageAssetId: job.selectedImageAssetId ?? null,
      expectedRemoteId: account.externalAccountId!, contentHash: article.contentHash
    })));
  }
  allowsRequest(channel: string, payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const data = payload as Record<string, unknown>;
    if (channel === "articles:prepare-publish") {
      if (data.finalPublishMode !== "CONFIRM_BEFORE_PUBLISH" || typeof data.articleId !== "string" || typeof data.platformKey !== "string") return false;
      const account = this.repository.listAccounts().find(item => item.platformAccountId === data.platformAccountId && item.platformKey === data.platformKey);
      return Boolean(account && this.matches({ accountId: account.id, articleId: data.articleId,
        platformKey: data.platformKey, selectedImageAssetId: typeof data.selectedImageAssetId === "string" ? data.selectedImageAssetId : null }));
    }
    if (!["jobs:confirm", "jobs:run"].includes(channel) || typeof data.id !== "string"
      || channel === "jobs:confirm" && data.dryRun !== false) return false;
    const job = this.repository.getJob(data.id);
    return Boolean(job && this.matches(job) && (this.repository.getSubmissionIntentByJob(job.id)?.finalSubmitCount ?? 0) === 0);
  }
  originalJob(platformKey: string, articleId: string, accountId: string): SprintJob | null {
    const matches = this.repository.listJobs().filter(job => job.platformKey === platformKey && job.articleId === articleId && job.accountId === accountId);
    if (matches.length > 1) throw new Error("SPRINT_JOB_QUOTA_ALREADY_EXCEEDED");
    return matches[0] ?? null;
  }
  assertFinalJob(job: SprintJob): void {
    if (!this.matches(job) || (this.repository.getSubmissionIntentByJob(job.id)?.finalSubmitCount ?? 0) !== 0)
      throw Object.assign(new Error("SPRINT_BOUNDARY_UNAUTHORIZED"), { code: "USER_ACTION_REQUIRED" });
  }
}
const selectionSchema = z.strictObject({ platformKey: z.enum(["weibo", "toutiao", "sohu_media", "cnblogs"]),
  accountId: z.string().min(1).max(128), articleId: z.string().min(1).max(128), imageAssetId: z.string().min(1).max(128).nullable(),
  expectedRemoteId: z.string().min(1).max(128), contentHash: z.string().regex(/^[a-f0-9]{64}$/u) });
const markerSchema = z.strictObject({ version: z.literal(1), purpose: z.literal("R1.15-D-ONE-SHOT"), expiresAt: z.iso.datetime(),
  selections: z.array(selectionSchema).min(1).max(4) });

export function readSprintAcceptance(packaged: boolean, resourcesPath: string): SprintAcceptanceSelection[] {
  if (!packaged) return [];
  try {
    const path = join(resourcesPath, SPRINT_ACCEPTANCE_MARKER), stat = statSync(path);
    if (!stat.isFile() || stat.size > 16_384) return [];
    const marker = markerSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    const remaining = Date.parse(marker.expiresAt) - Date.now();
    if (remaining <= 0 || remaining > 24 * 60 * 60_000
      || new Set(marker.selections.map(value => value.platformKey)).size !== marker.selections.length) return [];
    return marker.selections.map(selection => ({ ...selection, expiresAt: marker.expiresAt }));
  } catch { return []; }
}

export function sprintSelectionMatches(grant: SprintAcceptanceSelection, binding: Omit<SprintAcceptanceSelection, "expiresAt" | "platformKey"> & { platformKey: string }): boolean {
  return Date.parse(grant.expiresAt) > Date.now()
    && (["platformKey", "accountId", "articleId", "imageAssetId", "expectedRemoteId", "contentHash"] as const)
      .every(key => grant[key] === binding[key]);
}
