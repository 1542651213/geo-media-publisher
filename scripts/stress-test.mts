import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@publisher/db";
import { AdapterRegistry } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { createConsoleLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";

const startedAt = performance.now();
const dir = mkdtempSync(join(tmpdir(), "publisher-stress-"));
try {
  const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repository.listBrands()[0] ?? repository.createBrand({ name: "压力测试品牌", companyName: "TestPlatform" });
  const articleId = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO articles (id,brand_id,topic,keyword,city,title,body,summary,tags_json,seo_keywords_json,article_type,ai_provider,ai_model,generated_at,status,reuse_policy,content_hash,quality_status,quality_warnings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(articleId, brand.id, "stress", "stress", "南京", "压力测试文章", "压力测试正文".repeat(100), "摘要", "[]", "[]", "科普", "test", "stress", timestamp, "available", "always", `stress-${randomUUID()}`, "passed", "[]", timestamp, timestamp);
  const accountIds: string[] = [];
  const accountInsert = db.prepare("INSERT INTO accounts (id,platform_key,name,login_status,enabled,allow_auto_publish,minimum_interval_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  const accountTransaction = db.transaction(() => { for (let index = 0; index < 500; index += 1) { const id = randomUUID(); accountIds.push(id); accountInsert.run(id, "test", `压力账号-${index + 1}`, "logged_in", 1, 0, 0, timestamp, timestamp); } });
  accountTransaction();
  const articleInsert = db.prepare("INSERT INTO articles (id,brand_id,topic,keyword,city,title,body,summary,tags_json,seo_keywords_json,article_type,ai_provider,ai_model,generated_at,status,reuse_policy,content_hash,quality_status,quality_warnings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const articleTransaction = db.transaction(() => { for (let index = 1; index < 10_000; index += 1) articleInsert.run(randomUUID(), brand.id, "stress", `stress-${index}`, "南京", `压力文章-${index}`, "压力测试正文".repeat(20), "摘要", "[]", "[]", "科普", "test", "stress", timestamp, "available", "always", `stress-${index}-${randomUUID()}`, "passed", "[]", timestamp, timestamp); });
  articleTransaction();
  const jobInsert = db.prepare("INSERT INTO publish_jobs (id,account_id,platform_key,article_id,scheduled_at,status,attempt_count,max_attempts,created_at,dry_run,manual_confirmation_required) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const jobTransaction = db.transaction(() => { for (let index = 0; index < 50_000; index += 1) jobInsert.run(randomUUID(), accountIds[index % accountIds.length], "test", articleId, timestamp, "Scheduled", 0, 1, timestamp, 1, 1); });
  jobTransaction();
  const pageStarted = performance.now();
  const page = repository.listArticlesPage({ brandId: brand.id, page: 20, pageSize: 100 });
  const due = repository.listDueJobs(timestamp, 100);
  const queryMs = Math.round(performance.now() - pageStarted);
  const registry = new AdapterRegistry(); registry.register(new TestPlatformAdapter());
  const publisher = new PublisherService(repository, registry, createConsoleLogger());
  const scheduler = new PersistentScheduler(repository, publisher, createConsoleLogger(), 60_000, { globalConcurrency: 2, platformConcurrency: 1, accountConcurrency: 1 });
  const runStarted = performance.now();
  const result = await scheduler.runDueJobs(new Date(timestamp));
  const runMs = Math.round(performance.now() - runStarted);
  console.log(JSON.stringify({ articles: repository.listArticles({ brandId: brand.id }).length, accounts: accountIds.length, jobs: repository.listJobs().length, pageItems: page.items.length, pageTotal: page.total, boundedDue: due.length, schedulerResults: result.length, queryMs, schedulerMs: runMs, totalMs: Math.round(performance.now() - startedAt) }, null, 2));
  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
