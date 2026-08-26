import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const executablePath = process.env.V122_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const outputPath = join(process.cwd(), "output", "v122-platform-real-test-snapshot.json");
mkdirSync(join(process.cwd(), "output"), { recursive: true });

const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const snapshot = await page.evaluate(async () => {
    const views = await window.publisherAPI.platformSelfTest.list();
    const jobs = await window.publisherAPI.jobs.list();
    const targetPlatforms = new Set(["weibo", "bilibili", "sohu_media"]);
    return {
      capturedAt: new Date().toISOString(),
      accounts: views.filter((view) => targetPlatforms.has(view.account.platformKey)),
      jobs: jobs.filter((job) => targetPlatforms.has(job.platformKey)),
    };
  });
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, accounts: snapshot.accounts.length, jobs: snapshot.jobs.length }));
} finally {
  await electronApp.close();
}
