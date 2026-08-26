import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const jobId = "6fb37664-4340-4e1a-accd-865987e907df";
const accountId = "33418593-16eb-4ba4-8d61-0a0189cccd2e";
const outputPath = join(process.cwd(), "output", "v129-sohu-reconciliation-current.json");
const executablePath = process.env.V129_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
let before: unknown;
let result: unknown;
let after: unknown;
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const snapshot = await page.evaluate(async (id) => {
    const jobs = await window.publisherAPI.jobs.list();
    const job = jobs.find((item) => item.id === id);
    if (!job) throw new Error("SOHU_JOB_NOT_FOUND");
    if (job.platformKey !== "sohu_media" || job.status !== "NeedsReconciliation") throw new Error(`SOHU_JOB_NOT_READY:${job.platformKey}:${job.status}`);
    const records = await window.publisherAPI.articles.history(job.articleId);
    const article = await window.publisherAPI.articles.get(job.articleId);
    return { job, article, records };
  }, jobId);
  if (snapshot.job.platformAccountId !== accountId) throw new Error("SOHU_ACCOUNT_MISMATCH");
  before = snapshot;
  result = await page.evaluate((id) => window.publisherAPI.jobs.reconcileBrowser(id), jobId);
  after = await page.evaluate(async (id) => {
    const jobs = await window.publisherAPI.jobs.list();
    const job = jobs.find((item) => item.id === id) ?? null;
    return { job, article: job ? await window.publisherAPI.articles.get(job.articleId) : null, records: job ? await window.publisherAPI.articles.history(job.articleId) : [] };
  }, jobId);
} finally {
  await electronApp.close();
}
const evidence = { capturedAt: new Date().toISOString(), operation: "sohu_current_job_read_only_reconciliation", jobId, accountId, finalSubmitCalled: false, secondSubmitCalled: false, before, result, after };
mkdirSync(join(process.cwd(), "output"), { recursive: true });
writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({ outputPath, result: (result as { message?: string } | undefined)?.message ?? null, afterStatus: (after as { job?: { status?: string } } | undefined)?.job?.status ?? null }));
