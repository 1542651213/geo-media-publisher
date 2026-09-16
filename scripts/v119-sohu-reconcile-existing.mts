import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const jobId = "3993bc2f-73f8-4738-a321-2baf73e9d6cd";
const accountId = "33418593-16eb-4ba4-8d61-0a0189cccd2e";
const outputPath = join(process.cwd(), "output", "v119-sohu-reconcile-existing.json");
const executablePath = process.env.V119_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");

const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
let result: unknown;
let before: unknown;
let after: unknown;
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.getByRole("heading", { name: "首页", exact: true }).waitFor({ timeout: 30_000 });
  const jobs = await page.evaluate(() => window.publisherAPI.jobs.list());
  const oldJob = jobs.find((job) => job.id === jobId);
  if (!oldJob || oldJob.platformKey !== "sohu_media" || oldJob.platformAccountId !== accountId || oldJob.status !== "NeedsReconciliation") throw new Error(`Sohu old Job is not ready for read-only reconciliation: ${oldJob?.status ?? "missing"}`);
  before = { job: oldJob, records: await page.evaluate((articleId) => window.publisherAPI.articles.history(articleId), oldJob.articleId) };
  result = await page.evaluate((id) => window.publisherAPI.jobs.reconcileBrowser(id), jobId);
  const afterJobs = await page.evaluate(() => window.publisherAPI.jobs.list());
  const afterJob = afterJobs.find((job) => job.id === jobId);
  after = { job: afterJob ?? null, records: afterJob ? await page.evaluate((articleId) => window.publisherAPI.articles.history(articleId), afterJob.articleId) : [] };
} finally {
  await electronApp.close();
}

const evidence = { startedAt: new Date().toISOString(), operation: "sohu_existing_job_read_only_reconciliation", jobId, accountId, finalSubmitCalled: false, secondSubmitCalled: false, before, result, after, finishedAt: new Date().toISOString() };
mkdirSync(join(process.cwd(), "output"), { recursive: true });
writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({ outputPath, message: (result as { message?: string } | undefined)?.message ?? null, before: (before as { job?: { status?: string } } | undefined)?.job?.status ?? null, after: (after as { job?: { status?: string } } | undefined)?.job?.status ?? null }));
