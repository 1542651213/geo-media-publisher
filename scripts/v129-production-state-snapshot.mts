import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const outputPath = join(process.cwd(), "output", "v129-production-state-snapshot.json");
const executablePath = process.env.V129_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const snapshot = await page.evaluate(async () => {
    const [accounts, jobs, articles, selfTests] = await Promise.all([
      window.publisherAPI.accounts.list(),
      window.publisherAPI.jobs.list(),
      window.publisherAPI.articles.list(),
      window.publisherAPI.platformSelfTest.list()
    ]);
    const jobArticles = await Promise.all(jobs.map(async (job) => [job.id, await window.publisherAPI.articles.get(job.articleId)] as const));
    const reconciliationJobs = jobs.filter((job) => job.status === "NeedsReconciliation");
    const histories = await Promise.all(reconciliationJobs.map(async (job) => [job.id, await window.publisherAPI.articles.history(job.articleId)] as const));
    return { capturedAt: new Date().toISOString(), accounts, jobs, reconciliationJobs, articles, jobArticles: Object.fromEntries(jobArticles), selfTests, histories: Object.fromEntries(histories) };
  });
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, accounts: snapshot.accounts.length, jobs: snapshot.jobs.length, reconciliationJobs: snapshot.reconciliationJobs.length, selfTests: snapshot.selfTests.length }));
} finally {
  await electronApp.close();
}
