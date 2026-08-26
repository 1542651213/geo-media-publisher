import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const executablePath = process.env.V118_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const signalPath = process.env.V118_SIGNAL_PATH ?? join(process.cwd(), "output", "v118-lieju-continue.signal");
const evidencePath = join(process.cwd(), "output", "v118-lieju-real-acceptance.json");
const liejuAccountId = "e8f7c0b4-3aef-48ee-bced-2916e951435f";
mkdirSync(join(process.cwd(), "output"), { recursive: true });

const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), executablePath, platformKey: "lieju", platformAccountId: liejuAccountId, browserMode: "VISIBLE", finalSubmitMax: 1 };

try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.getByRole("heading", { name: "首页", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /账号中心/u }).first().click();
  await page.getByRole("heading", { name: "管理全部发布平台", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "平台自测", exact: true }).first().click();
  await page.getByRole("heading", { name: "平台自测中心", exact: true }).waitFor({ timeout: 30_000 });
  const rowTexts = await page.locator(".self-test-table-row").allInnerTexts();
  console.log(`V118_SELF_TEST_ROWS=${JSON.stringify(rowTexts)}`);
  const row = page.locator(".self-test-table-row").filter({ hasText: /01/iu }).filter({ hasText: /列举网|lieju/iu }).first();
  await row.getByRole("button", { name: "真实发布测试", exact: true }).click();
  await page.getByRole("heading", { name: "确认测试发布", exact: true }).waitFor({ timeout: 30_000 });
  const requested = await page.evaluate((accountId) => window.publisherAPI.platformSelfTest.list().then((views) => views.find((view) => (view.account.platformAccountId ?? view.account.id) === accountId)?.latestRun ?? null), liejuAccountId);
  if (!requested) throw new Error("Lieju-01 self-test run was not created");
  evidence.testRunId = requested.testRunId;
  console.log(`V118_CONFIRMATION_WAITING=${JSON.stringify({ testRunId: requested.testRunId, platformAccountId: liejuAccountId, message: "请由账号所有者在 Geo Media Publisher 确认测试发布；不要在列举网页面点击最终发布按钮" })}`);

  let run = requested;
  let lastSignature = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    run = await page.evaluate((testRunId) => window.publisherAPI.platformSelfTest.get(testRunId), run.testRunId) ?? run;
    const publishStep = run.steps.find((step) => step.stepKey === "PUBLISH_SUBMIT");
    const signature = `${run.overallResult}:${run.publishJobId ?? "none"}:${publishStep?.result ?? "none"}:${publishStep?.errorCode ?? "none"}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      console.log(`V118_RUN_STATE=${JSON.stringify({ overallResult: run.overallResult, publishJobId: run.publishJobId, publishStep: publishStep ? { result: publishStep.result, errorCode: publishStep.errorCode, message: publishStep.message, verificationSignal: publishStep.verificationSignal } : null })}`);
    }
    if (["PASSED", "FAILED", "PARTIAL_PASSED", "NOT_SUPPORTED"].includes(run.overallResult)) break;
    if (!existsSync(signalPath)) continue;
    unlinkSync(signalPath);
    console.log(`V118_CONTINUING=${JSON.stringify({ testRunId: run.testRunId, publishJobId: run.publishJobId, sameJob: true })}`);
    run = await page.evaluate((testRunId) => window.publisherAPI.platformSelfTest.continue(testRunId), run.testRunId);
  }
  const jobs = await page.evaluate(() => window.publisherAPI.jobs.list());
  const job = run.publishJobId ? jobs.find((item) => item.id === run.publishJobId) ?? null : null;
  evidence.finishedAt = new Date().toISOString();
  evidence.run = run;
  evidence.job = job;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`V118_FINAL=${JSON.stringify({ evidencePath, overallResult: run.overallResult, testRunId: run.testRunId, publishJobId: run.publishJobId, publishRecordId: run.publishRecordId, externalId: run.externalId, externalUrl: run.externalUrl, jobStatus: job?.status ?? null, finalSubmitMax: 1 })}`);
} finally {
  await electronApp.close();
}
