import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  companyName: text("company_name").notNull(),
  description: text("description").notNull(),
  industry: text("industry").notNull(),
  officialWebsite: text("official_website").notNull(),
  notes: text("notes").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull(),
  contentHash: text("content_hash").notNull(),
  useCount: integer("use_count").notNull(),
  publishCount: integer("publish_count").notNull(),
  qualityStatus: text("quality_status").notNull(),
  qualityWarnings: text("quality_warnings_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const publishJobs = sqliteTable("publish_jobs", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  platformKey: text("platform_key").notNull(),
  articleId: text("article_id").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  status: text("status").notNull(),
  attemptCount: integer("attempt_count").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  createdAt: text("created_at").notNull(),
  submissionIntentId: text("submission_intent_id"),
  externalId: text("external_id"),
  contentKind: text("content_kind").notNull(),
  videoAssetId: text("video_asset_id"),
  publishPayload: text("publish_payload_json").notNull()
});

export const videoAssets = sqliteTable("video_assets", {
  id: text("id").primaryKey(),
  localPath: text("local_path").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size_bytes").notNull(),
  durationMs: integer("duration_ms"),
  width: integer("width"),
  height: integer("height"),
  createdAt: text("created_at").notNull()
});

export const aiProviderProfiles = sqliteTable("ai_provider_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  credentialRef: text("credential_ref").notNull(),
  temperature: text("temperature").notNull(),
  maxOutputTokens: integer("max_output_tokens").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  retryCount: integer("retry_count").notNull(),
  concurrency: integer("concurrency").notNull(),
  enabled: integer("enabled").notNull(),
  isDefault: integer("is_default").notNull(),
  isFallback: integer("is_fallback").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const oneShotPublicationAuthorizations = sqliteTable("one_shot_publication_authorizations", {
  id: text("id").primaryKey(),
  authorization: text("authorization").notNull(),
  platformKey: text("platform_key").notNull(),
  accountId: text("account_id").notNull(),
  operationId: text("operation_id").notNull().unique(),
  mode: text("mode").notNull(),
  state: text("state").notNull(),
  publicationTransactionCount: integer("publication_transaction_count").notNull(),
  publicationCommitActionCount: integer("publication_commit_action_count").notNull(),
  finalSubmitAttemptCount: integer("final_submit_attempt_count").notNull(),
  finalSubmitRetryCount: integer("final_submit_retry_count").notNull(),
  finalSubmitActionStarted: integer("final_submit_action_started").notNull(),
  finalSubmitActionCompleted: integer("final_submit_action_completed").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  consumedAt: text("consumed_at")
});
