import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const jobIds = [
  "1bf90421-fa31-4a1f-b5a0-6639e671392b",
  "ea8c6507-ebb3-449a-9b01-227272ba4b77",
  "4b7cd010-ad60-4eb5-8290-0d63e0b28bbe"
];
const accountId = "8f666025-1776-41d5-8295-3bab150f615c";
const outputPath = join(process.cwd(), "output", "v129-zhihu-reconciliation-all.json");
const executablePath = process.env.V129_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
const results: Array<Record<string, unknown>> = [];
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  for (const jobId of jobIds) {
    const before = await page.evaluate(async (id) => {
      const jobs = await window.publisherAPI.jobs.list();
      const job = jobs.find((item) => item.id === id);
      if (!job) throw new Error(`ZHIHU_JOB_NOT_FOUND:${id}`);
      if (job.platformKey !== "zhihu" || job.status !== "NeedsReconciliation") throw new Error(`ZHIHU_JOB_NOT_READY:${id}:${job.platformKey}:${job.status}`);
      const article = await window.publisherAPI.articles.get(job.articleId);
      const records = await window.publisherAPI.articles.history(job.articleId);
      return { job, article, records };
    }, jobId);
    if (before.job.platformAccountId !== accountId) throw new Error(`ZHIHU_ACCOUNT_MISMATCH:${jobId}`);
    let result: unknown;
    let error: string | null = null;
    try {
      result = await page.evaluate((id) => window.publisherAPI.jobs.reconcileBrowser(id), jobId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const after = await page.evaluate(async (id) => {
      const jobs = await window.publisherAPI.jobs.list();
      const job = jobs.find((item) => item.id === id) ?? null;
      return { job, records: job ? await window.publisherAPI.articles.history(job.articleId) : [] };
    }, jobId);
    results.push({ jobId, accountId, finalSubmitCalled: false, secondSubmitCalled: false, before, result, error, after });
  }
} finally {
  await electronApp.close();
}
const evidence = { capturedAt: new Date().toISOString(), operation: "zhihu_all_needs_reconciliation_read_only", jobIds, accountId, results };
mkdirSync(join(process.cwd(), "output"), { recursive: true });
writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({ outputPath, results: results.map((item) => ({ jobId: item.jobId, message: (item.result as { message?: string } | undefined)?.message ?? item.error ?? null, afterStatus: (item.after as { job?: { status?: string } } | undefined)?.job?.status ?? null })) }));
