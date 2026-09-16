import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const accountId = "63a5c93c-e62f-4f6b-b2ae-58c1e1e01b38";
const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const databasePath = join(userDataPath, "production-data", "publisher.db");
const outputPath = join(process.cwd(), "output", "v130-baijiahao-real-publish.json");
const executablePath = process.env.V130_ELECTRON_EXE ?? join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");

mkdirSync(join(process.cwd(), "output"), { recursive: true });

type JsonRecord = Record<string, unknown>;

const evidence: JsonRecord = {
  startedAt: new Date().toISOString(),
  platformKey: "baijiahao",
  platformAccountId: accountId,
  browserMode: "VISIBLE",
  appOwnedVisibleBrowser: true,
  savedSessionRequired: true,
  finalSubmitMax: 1,
  confirmPublishCalls: 0
};

let electronApp: Awaited<ReturnType<typeof electron.launch>> | null = null;
let requestCreated = false;

try {
  electronApp = await electron.launch({
    executablePath,
    args: [process.cwd()],
    timeout: 30_000,
    env: { ...process.env, PUBLISHER_DATA_MODE: "production", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "1" }
  });
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  page.setDefaultTimeout(180_000);
  await page.waitForTimeout(2_000);

  const preflight = await page.evaluate(async (targetAccountId) => {
    const [accounts, platforms, views] = await Promise.all([
      window.publisherAPI.accounts.list(),
      window.publisherAPI.platforms.list(),
      window.publisherAPI.platformSelfTest.list()
    ]);
    const account = accounts.find((item) => (item.platformAccountId ?? item.id) === targetAccountId) ?? null;
    const platform = platforms.find((item) => item.platformKey === "baijiahao") ?? null;
    const view = views.find((item) => (item.account.platformAccountId ?? item.account.id) === targetAccountId) ?? null;
    return {
      account,
      platform: platform ? { platformKey: platform.platformKey, integrationMode: platform.integrationMode, capabilities: platform.capabilities } : null,
      latestRun: view?.latestRun ?? null
    };
  }, accountId);

  const account = preflight.account;
  if (!account || account.platformKey !== "baijiahao" || account.enabled !== true || account.loginStatus !== "logged_in" || account.connectionMode !== "BrowserAutomation" || account.authorizationStatus !== "Authorized" || !account.browserSessionId) {
    throw new Error(`Baijiahao target preflight failed: ${JSON.stringify({ account })}`);
  }
  if (preflight.latestRun?.requestedLevel === "L5_PUBLISH") {
    throw new Error(`Baijiahao already has a latest L5 run; refusing to create another: ${preflight.latestRun.testRunId}`);
  }
  evidence.preflight = {
    account: {
      id: account.id,
      platformAccountId: account.platformAccountId ?? account.id,
      platformKey: account.platformKey,
      accountName: account.accountName ?? account.name,
      enabled: account.enabled,
      loginStatus: account.loginStatus,
      connectionMode: account.connectionMode,
      authorizationStatus: account.authorizationStatus,
      browserSessionIdPresent: Boolean(account.browserSessionId)
    },
    platform: preflight.platform,
    latestRun: preflight.latestRun
  };

  const requested = await page.evaluate((targetAccountId) => window.publisherAPI.platformSelfTest.requestPublish(targetAccountId), accountId);
  requestCreated = true;
  evidence.requestedRun = requested;
  if (requested.overallResult !== "WAITING_FOR_USER" || requested.requestedLevel !== "L5_PUBLISH") {
    throw new Error(`Baijiahao publish confirmation state was not created as WAITING_FOR_USER: ${JSON.stringify(requested)}`);
  }

  evidence.confirmPublishCalls = 1;
  const confirmed = await page.evaluate((testRunId) => window.publisherAPI.platformSelfTest.confirmPublish(testRunId), requested.testRunId);
  evidence.confirmedRun = confirmed;

  const postRun = await page.evaluate(async (testRunId) => {
    const run = await window.publisherAPI.platformSelfTest.get(testRunId);
    const jobs = await window.publisherAPI.jobs.list();
    const job = run?.publishJobId ? jobs.find((item) => item.id === run.publishJobId) ?? null : null;
    const article = job ? await window.publisherAPI.articles.get(job.articleId) : null;
    const records = article ? await window.publisherAPI.articles.history(article.id) : [];
    return { run, job, article, records };
  }, confirmed.testRunId);
  evidence.postRun = postRun;
} catch (error) {
  evidence.error = { message: error instanceof Error ? error.message : String(error), requestCreated, confirmPublishCalls: evidence.confirmPublishCalls };
} finally {
  if (electronApp) await electronApp.close();
}

try {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(databasePath, { readonly: true });
  const postRun = evidence.postRun as JsonRecord | undefined;
  const jobId = typeof postRun?.job === "object" && postRun.job !== null && "id" in postRun.job && typeof postRun.job.id === "string" ? postRun.job.id : null;
  const run = postRun?.run as JsonRecord | undefined;
  const testRunId = typeof run?.testRunId === "string" ? run.testRunId : null;
  const job = jobId ? db.prepare("SELECT id, article_id, platform_key, account_id, status, external_id, publish_record_id, last_error_code FROM publish_jobs WHERE id=?").get(jobId) : null;
  const record = jobId ? db.prepare("SELECT id, job_id, account_id, platform_account_id, platform_key, article_id, published_url, published_external_id, success, response_json, published_at, dry_run, status, publish_mode, automation_type, browser_session_id_hash, verification_status, editor_opened_at, title_filled, body_filled, selected_image_asset_id, image_selection_mode FROM publish_records WHERE job_id=? ORDER BY published_at DESC LIMIT 1").get(jobId) : null;
  const intent = jobId ? db.prepare("SELECT id, job_id, state, external_id, attempt, final_submit_count, error_code, updated_at FROM submission_intents WHERE job_id=? ORDER BY created_at DESC LIMIT 1").get(jobId) : null;
  const persistedRun = testRunId ? db.prepare("SELECT test_run_id, platform_key, platform_account_id, requested_level, overall_result, publish_job_id, publish_record_id, external_id, external_url, publish_confirmed_at FROM platform_self_test_runs WHERE test_run_id=?").get(testRunId) : null;
  evidence.dbAudit = { databasePath, job, record, intent, platformSelfTestRun: persistedRun };
  db.close();
} catch (error) {
  evidence.dbAuditError = { message: error instanceof Error ? error.message : String(error) };
}

evidence.finishedAt = new Date().toISOString();
writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
console.log(`V130_FINAL=${JSON.stringify({ outputPath, requestCreated, confirmPublishCalls: evidence.confirmPublishCalls, overallResult: (evidence.confirmedRun as JsonRecord | undefined)?.overallResult ?? null, publishJobId: ((evidence.confirmedRun as JsonRecord | undefined)?.publishJobId ?? null), externalId: ((evidence.confirmedRun as JsonRecord | undefined)?.externalId ?? null), externalUrl: ((evidence.confirmedRun as JsonRecord | undefined)?.externalUrl ?? null) })}`);
