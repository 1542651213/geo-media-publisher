import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const executablePath = process.env.V119_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const testRunId = "3e58a669-072f-4373-bff1-d1dcccaa5f17";
const outputDir = join(process.cwd(), "output");
const signalPath = join(outputDir, "v119-sohu-resume.signal");
const evidencePath = join(outputDir, "v121-sohu-deep-discovery-run.json");
mkdirSync(outputDir, { recursive: true });

const electronApp = await electron.launch({ executablePath, args: [process.cwd()], timeout: 30_000, env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" } });
const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), executablePath, platformKey: "sohu_media", testRunId, browserMode: "VISIBLE", finalSubmitMax: 1, resumedExistingJob: true };

try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  let run = await page.evaluate((id) => window.publisherAPI.platformSelfTest.get(id), testRunId);
  if (!run || run.platformKey !== "sohu_media" || !run.publishJobId) throw new Error("Existing Sohu V1.1.9 waiting run was not found");

  let lastSignature = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    run = await page.evaluate((id) => window.publisherAPI.platformSelfTest.get(id), testRunId) ?? run;
    const submit = run.steps.find((step) => step.stepKey === "PUBLISH_SUBMIT");
    const signature = `${run.overallResult}:${run.publishJobId ?? "none"}:${submit?.result ?? "none"}:${submit?.errorCode ?? "none"}:${submit?.message ?? ""}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      console.log(`V119_RESUME_STATE=${JSON.stringify({ overallResult: run.overallResult, publishJobId: run.publishJobId, submit: submit ? { result: submit.result, errorCode: submit.errorCode, message: submit.message, verificationSignal: submit.verificationSignal } : null })}`);
      writeFileSync(evidencePath, JSON.stringify({ ...evidence, updatedAt: new Date().toISOString(), run, waiting: run.overallResult === "WAITING_FOR_USER", publishJobId: run.publishJobId }, null, 2), "utf8");
    }
    if (["PASSED", "FAILED", "PARTIAL_PASSED", "NOT_SUPPORTED"].includes(run.overallResult)) break;
    if (!existsSync(signalPath)) continue;
    unlinkSync(signalPath);
    console.log(`V119_RESUME_CONTINUING=${JSON.stringify({ testRunId, publishJobId: run.publishJobId, sameJob: true, finalSubmitMax: 1 })}`);
    run = await page.evaluate((id) => window.publisherAPI.platformSelfTest.continue(id), testRunId);
  }
  const jobs = await page.evaluate(() => window.publisherAPI.jobs.list());
  const job = run.publishJobId ? jobs.find((item) => item.id === run.publishJobId) ?? null : null;
  evidence.finishedAt = new Date().toISOString();
  evidence.run = run;
  evidence.job = job;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`V119_RESUME_FINAL=${JSON.stringify({ evidencePath, overallResult: run.overallResult, testRunId: run.testRunId, publishJobId: run.publishJobId, publishRecordId: run.publishRecordId, externalId: run.externalId, externalUrl: run.externalUrl, jobStatus: job?.status ?? null, finalSubmitMax: 1 })}`);
} finally {
  await electronApp.close();
}
