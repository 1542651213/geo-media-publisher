import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const executablePath = process.env.V119_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const accountId = "33418593-16eb-4ba4-8d61-0a0189cccd2e";
const outputDir = join(process.cwd(), "output");
const signalPath = join(outputDir, "v119-sohu-continue.signal");
const evidencePath = join(outputDir, "v119-sohu-real-acceptance.json");
mkdirSync(outputDir, { recursive: true });

const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), executablePath, platformKey: "sohu_media", platformAccountId: accountId, browserMode: "VISIBLE", finalSubmitMax: 1 };

try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.getByRole("heading", { name: "首页", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /账号中心/u }).first().click();
  await page.getByRole("heading", { name: "管理全部发布平台", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "平台自测", exact: true }).first().click();
  await page.getByRole("heading", { name: "平台自测中心", exact: true }).waitFor({ timeout: 30_000 });
  const row = page.locator(".self-test-table-row").filter({ hasText: /搜狐号账号/u }).first();
  await row.getByRole("button", { name: "真实发布测试", exact: true }).click();
  await page.getByRole("heading", { name: "确认测试发布", exact: true }).waitFor({ timeout: 30_000 });
  const requested = await page.evaluate((id) => window.publisherAPI.platformSelfTest.list().then((views) => views.find((view) => (view.account.platformAccountId ?? view.account.id) === id)?.latestRun ?? null), accountId);
  if (!requested) throw new Error("Sohu account self-test run was not created");
  evidence.testRunId = requested.testRunId;
  await page.getByRole("button", { name: "确认测试发布", exact: true }).click();

  let run = requested;
  let lastSignature = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    run = await page.evaluate((testRunId) => window.publisherAPI.platformSelfTest.get(testRunId), run.testRunId) ?? run;
    const submit = run.steps.find((step) => step.stepKey === "PUBLISH_SUBMIT");
    const signature = `${run.overallResult}:${run.publishJobId ?? "none"}:${submit?.result ?? "none"}:${submit?.errorCode ?? "none"}:${submit?.message ?? ""}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      console.log(`V119_RUN_STATE=${JSON.stringify({ overallResult: run.overallResult, publishJobId: run.publishJobId, editorUrl: run.steps.find((step) => step.stepKey === "EDITOR_OPEN")?.verificationSignal ?? null, title: run.steps.find((step) => step.stepKey === "TITLE_FILL")?.result ?? null, body: run.steps.find((step) => step.stepKey === "BODY_FILL")?.result ?? null, image: run.steps.find((step) => step.stepKey === "IMAGE_FILL")?.result ?? null, submit: submit ? { result: submit.result, errorCode: submit.errorCode, message: submit.message, verificationSignal: submit.verificationSignal } : null })}`);
    }
    if (["PASSED", "FAILED", "PARTIAL_PASSED", "NOT_SUPPORTED"].includes(run.overallResult)) break;
    if (!existsSync(signalPath)) continue;
    unlinkSync(signalPath);
    console.log(`V119_CONTINUING=${JSON.stringify({ testRunId: run.testRunId, publishJobId: run.publishJobId, sameJob: true })}`);
    run = await page.evaluate((testRunId) => window.publisherAPI.platformSelfTest.continue(testRunId), run.testRunId);
  }
  const jobs = await page.evaluate(() => window.publisherAPI.jobs.list());
  const job = run.publishJobId ? jobs.find((item) => item.id === run.publishJobId) ?? null : null;
  evidence.finishedAt = new Date().toISOString();
  evidence.run = run;
  evidence.job = job;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`V119_FINAL=${JSON.stringify({ evidencePath, overallResult: run.overallResult, testRunId: run.testRunId, publishJobId: run.publishJobId, publishRecordId: run.publishRecordId, externalId: run.externalId, externalUrl: run.externalUrl, jobStatus: job?.status ?? null, finalSubmitMax: 1 })}`);
} finally {
  await electronApp.close();
}
