import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type ReconciliationRepository = {
  reconcileFailedOneShotConfirmation: (identity: { testRunId: string; platformKey: string; accountId: string }) => {
    status: "RECONCILED_RETRYABLE" | "ALREADY_RECONCILED";
    mutationCount: 0 | 1;
    retryEligible: boolean;
  };
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "task10u-reconciliation-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10U 测试账号" });
  const run = database.repository.createPlatformSelfTestRun({ platformAccountId: account.platformAccountId ?? account.id, requestedLevel: "L5_PUBLISH" });
  database.repository.recordPlatformSelfTestStep({
    testRunId: run.testRunId,
    testLevel: "L5_PUBLISH",
    stepKey: "PUBLISH_CONFIRMATION",
    startedAt: "2026-09-01T04:00:00.000Z",
    result: "WAITING_FOR_USER",
    errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED",
    message: "一次性真实发布测试需要 Owner 确认",
    verificationSignal: "authorization:OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH:state:NOT_AUTHORIZED"
  });
  database.repository.finishPlatformSelfTestRun(run.testRunId, "WAITING_FOR_USER");
  database.db.prepare("UPDATE platform_self_test_runs SET publish_confirmed_at=? WHERE test_run_id=?").run("2026-09-01T04:00:10.700Z", run.testRunId);
  return { database, account, run, repository: database.repository as unknown as ReconciliationRepository };
}

describe("Task10U failed one-shot confirmation reconciliation", () => {
  it("restores the exact orphan to canonical retryable pre-confirm state and is idempotent", () => {
    const { database, account, run, repository } = fixture();
    const identity = { testRunId: run.testRunId, platformKey: "xiaohongshu", accountId: account.id };

    const first = repository.reconcileFailedOneShotConfirmation(identity);
    const second = repository.reconcileFailedOneShotConfirmation(identity);

    expect(first).toEqual({ status: "RECONCILED_RETRYABLE", testRunId: run.testRunId, mutationCount: 1, retryEligible: true });
    expect(second).toEqual({ status: "ALREADY_RECONCILED", testRunId: run.testRunId, mutationCount: 0, retryEligible: true });
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)).toMatchObject({
      overallResult: "WAITING_FOR_USER",
      publishConfirmedAt: null,
      publishJobId: null,
      publishRecordId: null,
      externalId: null,
      externalUrl: null
    });
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepKey: "PUBLISH_CONFIRMATION", result: "WAITING_FOR_USER", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" })
    ]));
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations WHERE operation_id=?").get(run.testRunId)).toMatchObject({ count: 0 });
  });

  it("rolls back the confirmation reset and step update together", () => {
    const { database, account, run, repository } = fixture();
    database.db.exec("CREATE TRIGGER task10u_fail_reconciliation_step AFTER UPDATE OF result ON platform_self_test_steps BEGIN SELECT RAISE(ABORT, 'forced reconciliation failure'); END;");

    expect(() => repository.reconcileFailedOneShotConfirmation({ testRunId: run.testRunId, platformKey: "xiaohongshu", accountId: account.id })).toThrow("forced reconciliation failure");
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)?.publishConfirmedAt).toBe("2026-09-01T04:00:10.700Z");
    expect(database.repository.getPlatformSelfTestRun(run.testRunId)?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepKey: "PUBLISH_CONFIRMATION", result: "WAITING_FOR_USER" })
    ]));
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations").get()).toMatchObject({ count: 0 });
  });
});
